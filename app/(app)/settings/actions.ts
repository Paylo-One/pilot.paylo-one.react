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
