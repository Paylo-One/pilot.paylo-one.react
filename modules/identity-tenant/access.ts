import "server-only";

import { createSupabaseSecretClient } from "@/lib/supabase/secret";

export type TenantAccessStatus = "active" | "suspended";

export interface TenantAccessRecord {
  readonly status: TenantAccessStatus;
  readonly suspensionReasonCode: string | null;
  readonly suspensionReason: string | null;
  readonly suspendedAt: string | null;
  readonly accessGrantType: "paid" | "complimentary" | "beta_exempt";
  readonly paymentEnforcementExempt: boolean;
  readonly manualOverrideActive: boolean;
}

/**
 * Authoritative application-access lookup. Payment and subscription fields are
 * deliberately absent: they inform operations, but do not grant or deny entry.
 */
export async function getTenantAccess(
  tenantId: string,
): Promise<TenantAccessRecord | null> {
  const db = createSupabaseSecretClient();
  const { data, error } = await db
    .from("tenants")
    .select(
      "status, suspension_reason_code, suspension_reason, suspended_at, access_grant_type, payment_enforcement_exempt, manual_override_active",
    )
    .eq("id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !["active", "suspended"].includes(data.status)) return null;

  return {
    status: data.status as TenantAccessStatus,
    suspensionReasonCode: data.suspension_reason_code,
    suspensionReason: data.suspension_reason,
    suspendedAt: data.suspended_at,
    accessGrantType: data.access_grant_type,
    paymentEnforcementExempt: data.payment_enforcement_exempt,
    manualOverrideActive: data.manual_override_active,
  };
}
