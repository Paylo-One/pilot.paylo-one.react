import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { tenantBaseUrl } from "@/lib/config";
import { seedTenantPrompts } from "@/modules/prompt-versioning/server";
import { referralService } from "@/modules/referral";
import { createTrialBillingAccess } from "@/modules/billing/access";

export type ActivationInvitationStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired";

export interface PreparedActivation {
  readonly invitationId: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantSlug: string;
  readonly contactName: string | null;
  readonly email: string;
  readonly status: ActivationInvitationStatus;
  readonly expiresAt: string;
  readonly acceptedUserId: string | null;
}

export interface ActivatePreparedTenantResult {
  readonly tenantId: string;
  readonly slug: string;
  readonly redirectTo: string;
  readonly created: boolean;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isActivationToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function inspectPreparedActivation(
  token: string,
): Promise<PreparedActivation | null> {
  if (!isActivationToken(token)) return null;

  const secret = createSupabaseSecretClient();
  const { data: invitation, error } = await secret
    .from("tenant_activation_invitations")
    .select(
      "id, tenant_id, onboarding_request_id, email, status, expires_at, accepted_user_id",
    )
    .eq("token_hash", `\\x${tokenHash(token)}`)
    .maybeSingle();

  if (error || !invitation) return null;

  const [{ data: tenant }, { data: onboarding }] = await Promise.all([
    secret
      .from("tenants")
      .select("id, name, slug")
      .eq("id", invitation.tenant_id)
      .maybeSingle(),
    secret
      .from("onboarding_requests")
      .select("contact_name")
      .eq("id", invitation.onboarding_request_id)
      .maybeSingle(),
  ]);

  if (!tenant) return null;

  const status =
    invitation.status === "pending" &&
    Date.parse(invitation.expires_at as string) <= Date.now()
      ? "expired"
      : (invitation.status as ActivationInvitationStatus);

  return {
    invitationId: invitation.id as string,
    tenantId: tenant.id as string,
    tenantName: tenant.name as string,
    tenantSlug: tenant.slug as string,
    contactName: (onboarding?.contact_name as string | null) ?? null,
    email: invitation.email as string,
    status,
    expiresAt: invitation.expires_at as string,
    acceptedUserId: (invitation.accepted_user_id as string | null) ?? null,
  };
}

export async function activatePreparedTenant(input: {
  token: string;
  userId: string;
  displayName: string | null;
}): Promise<ActivatePreparedTenantResult> {
  if (!isActivationToken(input.token)) {
    throw new Error("activation_invalid");
  }

  const secret = createSupabaseSecretClient();
  const { data, error } = await secret.rpc("activate_prepared_tenant", {
    p_token_hash: tokenHash(input.token),
    p_user_id: input.userId,
    p_display_name: input.displayName,
    p_correlation_id: randomUUID(),
  });

  if (error) {
    if (error.code === "42501") throw new Error("activation_email_mismatch");
    if (error.code === "P0002") throw new Error("activation_not_found");
    if (error.code === "22023" || error.code === "23505") {
      throw new Error(error.message);
    }
    throw new Error("activation_failed");
  }

  if (!data || typeof data !== "object") {
    throw new Error("activation_failed");
  }

  const result = data as {
    created: boolean;
    tenantId: string;
    slug: string;
  };

  if (result.created) {
    try {
      await createTrialBillingAccess({
        tenantId: result.tenantId,
        userId: input.userId,
      });
    } catch {
      await secret.from("audit_events").insert({
        tenant_id: result.tenantId,
        user_id: input.userId,
        action: "billing.trial_initialisation_failed",
        target: result.tenantId,
        metadata: { via: "admin_owner_activation" },
      });
    }

    try {
      await seedTenantPrompts(result.tenantId, input.userId);
      await secret.from("audit_events").insert({
        tenant_id: result.tenantId,
        user_id: input.userId,
        action: "prompt.defaults.seeded",
        target: result.tenantId,
        metadata: { via: "admin_owner_activation" },
      });
    } catch {
      /* prompt library lazily seeds on first read */
    }

    try {
      await referralService.getOrCreateForOwner(input.userId, result.tenantId);
    } catch {
      /* Settings lazily creates the owner's referral code */
    }
  }

  return {
    tenantId: result.tenantId,
    slug: result.slug,
    redirectTo: tenantBaseUrl(result.slug),
    created: result.created,
  };
}
