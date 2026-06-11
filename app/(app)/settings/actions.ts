"use server";

/**
 * Server actions for the Settings surface: persist the signed-in user's own
 * user_profiles row, and passkey enrolment + device management. Tenant context
 * is re-derived server-side; user-owned rows are written with the USER server
 * client so RLS guarantees a user can only ever touch their own rows.
 */

import { revalidatePath } from "next/cache";
import {
  requireTenantContext,
  getSignedInUser,
} from "@/modules/identity-tenant/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  beginPasskeyRegistration,
  completePasskeyRegistration,
  renamePasskey,
  revokePasskey,
  type PasskeyRegistrationStart,
} from "@/modules/authentication/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { auditService } from "@/modules/audit";
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

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("user_profiles").upsert(
    {
      user_id: ctx.userId,
      display_name: displayName,
      timezone,
      briefing_time: briefingTime,
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

// --- Passkey enrolment + device management -----------------------------------

/** Issue a registration challenge for the signed-in user (RP ID = apex). */
export async function beginPasskeyRegistrationAction(): Promise<PasskeyRegistrationStart> {
  await requireTenantContext();
  const user = await getSignedInUser();
  if (!user) throw new Error("unauthenticated");
  return beginPasskeyRegistration(user);
}

export interface PasskeyActionResult {
  ok: boolean;
  error: string | null;
}

/** Verify the attestation and store the credential; audited per tenant. */
export async function completePasskeyRegistrationAction(input: {
  token: string;
  response: RegistrationResponseJSON;
  label?: string | null;
}): Promise<PasskeyActionResult> {
  const ctx = await requireTenantContext();

  const outcome = await completePasskeyRegistration({
    ctx,
    token: input.token,
    response: input.response,
    label: input.label,
  });
  if (!outcome.ok) return { ok: false, error: outcome.error ?? "registration_failed" };

  await auditService.record(ctx, {
    action: "auth.passkey.registered",
    target: outcome.credentialRowId,
    metadata: { label: input.label?.trim() || null },
  });

  revalidatePath("/settings");
  return { ok: true, error: null };
}

/** Relabel one of the user's own passkeys. */
export async function renamePasskeyAction(input: {
  credentialRowId: string;
  label: string;
}): Promise<PasskeyActionResult> {
  await requireTenantContext();
  try {
    await renamePasskey(input.credentialRowId, input.label);
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "rename_failed" };
  }
  revalidatePath("/settings");
  return { ok: true, error: null };
}

/** Revoke one of the user's own passkeys; audited per tenant. */
export async function revokePasskeyAction(input: {
  credentialRowId: string;
}): Promise<PasskeyActionResult> {
  const ctx = await requireTenantContext();
  try {
    await revokePasskey(input.credentialRowId);
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "revoke_failed" };
  }
  await auditService.record(ctx, {
    action: "auth.passkey.revoked",
    target: input.credentialRowId,
  });
  revalidatePath("/settings");
  return { ok: true, error: null };
}
