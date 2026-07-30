"use server";

/**
 * Server actions for the Settings surface: persist the signed-in user's own
 * user_profiles row, and record audit events for passkey lifecycle changes.
 * Tenant context is re-derived server-side; the profile is written with the
 * USER server client so RLS (user_profiles_self_*) guarantees a user can only
 * ever write their own row (user_id = auth.uid()).
 *
 * Passkey credentials themselves are owned by Supabase Auth (native WebAuthn);
 * the enrolment/revocation ceremonies run client-side. These actions only mint
 * the tenant-scoped audit trail after a ceremony succeeds — credential material
 * never passes through here.
 */

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { auditService } from "@/modules/audit";
import {
  addTenantModelProvider,
  deactivateTenantModelProviders,
  deleteTenantModelProvider,
  setActiveTenantModelProvider,
  verifyTenantModelProvider,
} from "@/modules/tenant-models/server";
import type { TenantModelProviderKind, TenantModelStatus } from "@/modules/tenant-models";
import type { ProfileFormState } from "./types";

/** Basic IANA-style timezone shape check; empty falls back to UTC. */
function normaliseTimezone(raw: string): string {
  const value = raw.trim();
  return value.length > 0 ? value : "UTC";
}

/** HTML time inputs yield "HH:MM"; empty means "no preference" (null). */
function normaliseBriefingTime(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0) return null;
  return /^\d{2}:\d{2}$/.test(value) ? value : null;
}

export async function saveProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const ctx = await requireTenantContext();

  const displayNameRaw = String(formData.get("display_name") ?? "").trim();
  const displayName = displayNameRaw.length > 0 ? displayNameRaw : null;
  const timezone = normaliseTimezone(String(formData.get("timezone") ?? ""));
  const briefingTime = normaliseBriefingTime(
    String(formData.get("briefing_time") ?? ""),
  );
  // Unchecked checkboxes are absent from FormData; presence means enabled.
  const dailyBriefingEmail = formData.get("daily_briefing_email") != null;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("user_profiles").upsert(
    {
      user_id: ctx.userId,
      display_name: displayName,
      timezone,
      briefing_time: briefingTime,
      daily_briefing_email: dailyBriefingEmail,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  await auditService.record(ctx, { action: "profile.updated" });

  revalidatePath("/settings");
  return { ok: true, error: null };
}

// --- Bring-your-own model providers (ADR-038) --------------------------------
//
// The API key is handed to the server module (secret client, server-only table)
// and never echoed back. Actions return only non-secret outcome data; every
// mutation is audited with the provider + model (never the key).

interface ModelProviderResult {
  readonly ok: boolean;
  readonly error: string | null;
  readonly id?: string;
  readonly status?: TenantModelStatus;
}

/**
 * Register a BYO provider key and immediately verify it with a real test call.
 * Returns the verification status so the UI can reflect verified/failed at once.
 */
export async function addModelProviderAction(input: {
  provider: TenantModelProviderKind;
  modelId: string;
  displayName?: string;
  apiKey: string;
}): Promise<ModelProviderResult> {
  const ctx = await requireTenantContext();

  const added = await addTenantModelProvider(ctx, {
    provider: input.provider,
    modelId: input.modelId,
    displayName: input.displayName,
    apiKey: input.apiKey,
  });
  if (!added.ok) return { ok: false, error: added.error.message };

  await auditService.record(ctx, {
    action: "model.provider.added",
    target: added.value.id,
    metadata: { provider: input.provider, modelId: input.modelId.trim() },
  });

  const verified = await verifyTenantModelProvider(ctx, added.value.id);
  if (verified.ok) {
    await auditService.record(ctx, {
      action: "model.provider.verified",
      target: added.value.id,
      metadata: { provider: input.provider, status: verified.value.status },
    });
  }

  revalidatePath("/settings");
  return {
    ok: true,
    error: null,
    id: added.value.id,
    status: verified.ok ? verified.value.status : "untested",
  };
}

/** Re-test an existing provider's key (e.g. after a key rotation). */
export async function verifyModelProviderAction(input: {
  id: string;
}): Promise<ModelProviderResult> {
  const ctx = await requireTenantContext();
  if (!input?.id) return { ok: false, error: "Missing provider id." };

  const result = await verifyTenantModelProvider(ctx, input.id);
  if (!result.ok) return { ok: false, error: result.error.message };

  await auditService.record(ctx, {
    action: "model.provider.verified",
    target: input.id,
    metadata: { status: result.value.status },
  });
  revalidatePath("/settings");
  return {
    ok: true,
    error: result.value.error,
    id: input.id,
    status: result.value.status,
  };
}

/** Make a verified provider the workspace's active routing choice. */
export async function activateModelProviderAction(input: {
  id: string;
}): Promise<ModelProviderResult> {
  const ctx = await requireTenantContext();
  if (!input?.id) return { ok: false, error: "Missing provider id." };

  const result = await setActiveTenantModelProvider(ctx, input.id);
  if (!result.ok) return { ok: false, error: result.error.message };

  await auditService.record(ctx, {
    action: "model.provider.activated",
    target: input.id,
    metadata: {},
  });
  revalidatePath("/settings");
  return { ok: true, error: null, id: input.id };
}

/** Stop routing through BYO — revert the workspace to the Paylo-hosted default. */
export async function revertToDefaultModelProviderAction(): Promise<ModelProviderResult> {
  const ctx = await requireTenantContext();
  const result = await deactivateTenantModelProviders(ctx);
  if (!result.ok) return { ok: false, error: result.error.message };

  await auditService.record(ctx, { action: "model.provider.deactivated", metadata: {} });
  revalidatePath("/settings");
  return { ok: true, error: null };
}

/** Remove a provider and its stored key entirely. */
export async function removeModelProviderAction(input: {
  id: string;
}): Promise<ModelProviderResult> {
  const ctx = await requireTenantContext();
  if (!input?.id) return { ok: false, error: "Missing provider id." };

  const result = await deleteTenantModelProvider(ctx, input.id);
  if (!result.ok) return { ok: false, error: result.error.message };

  await auditService.record(ctx, {
    action: "model.provider.removed",
    target: input.id,
    metadata: {},
  });
  revalidatePath("/settings");
  return { ok: true, error: null, id: input.id };
}

/**
 * Record a passkey enrolment/revocation in the tenant audit trail. Called by the
 * Settings passkey card after the native Supabase ceremony succeeds; the
 * credential id is the opaque Supabase passkey id (never key material).
 */
export async function recordPasskeyAuditAction(input: {
  action: "registered" | "revoked";
  credentialId: string;
  label?: string | null;
}): Promise<void> {
  const ctx = await requireTenantContext();
  await auditService.record(ctx, {
    action: input.action === "registered" ? "auth.passkey.registered" : "auth.passkey.revoked",
    target: input.credentialId,
    metadata: { label: input.label?.trim() || null },
  });
}
