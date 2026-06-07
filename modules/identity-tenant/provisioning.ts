/**
 * modules/identity-tenant/provisioning.ts
 *
 * Tenant provisioning pipeline. Governance:
 * governance/docs/architecture/multi-tenancy-design.md §"Tenant Provisioning".
 *
 * Pipeline (idempotent and audited):
 *   invite accepted + payment captured
 *     → create tenant (slug, status=provisioning)
 *     → create user_profile + tenant_users(owner)
 *     → reserve subdomain → tenant_domains(subdomain, verified=true for *.paylo.one)
 *     → seed default data_retention_policies (conservative: summaries_only)
 *     → status=active → redirect to <slug>.paylo.one onboarding
 *
 * Idempotency: keyed by the invite token (+ payment reference) so a retried
 * call returns the same tenant rather than creating a duplicate.
 *
 * Scaffold note: the method throws `NotImplementedError`. The conservative
 * default retention policy is `summaries_only` — referenced from
 * `@/modules/shared` so the seed stays aligned with the data model.
 */

import {
  NotImplementedError,
  type Result,
  type StoragePolicy,
} from "@/modules/shared";
import type { Tenant } from "./types";

/**
 * The conservative default retention seeded for a new tenant
 * (multi-tenancy-design.md §"Tenant Provisioning"). Re-uses the shared
 * `StoragePolicy` enum rather than a bare string.
 */
export const DEFAULT_RETENTION_POLICY: StoragePolicy = "summaries_only";

/**
 * Inputs to provisioning. The invite token + payment reference are the
 * idempotency key; `desiredSubdomain` flows into the reserve step.
 */
export interface ProvisionTenantInput {
  /** Invite token from Billing/onboarding (idempotency key part 1). */
  readonly inviteToken: string;
  /** Captured-payment reference from Billing (idempotency key part 2). */
  readonly paymentReference: string;
  /** Verified `auth.users` id that becomes the tenant `owner`. */
  readonly ownerUserId: string;
  /** Human-facing workspace name. */
  readonly tenantName: string;
  /** Canonical slug; also the chosen `*.paylo.one` subdomain. */
  readonly desiredSubdomain: string;
  /** Billing plan key, if known at provisioning time. */
  readonly plan?: string;
}

/** Result of a successful (idempotent) provisioning run. */
export interface ProvisionTenantResult {
  /** The provisioned tenant, now `status="active"`. */
  readonly tenant: Tenant;
  /** Where to send the owner next — the tenant's onboarding URL. */
  readonly redirectTo: string;
  /** True when this call created the tenant; false on an idempotent replay. */
  readonly created: boolean;
}

/**
 * Provisioning service. Single entrypoint that executes the documented
 * pipeline atomically (or resumes it idempotently).
 *
 * Scaffold: throws `NotImplementedError`.
 */
export interface TenantProvisioningService {
  /**
   * Execute the full provisioning pipeline. Idempotent on
   * `(inviteToken, paymentReference)`; every step is audited. On success the
   * tenant is `active` and the owner is redirected to `<slug>.paylo.one`.
   */
  provisionTenant(
    input: ProvisionTenantInput,
  ): Promise<Result<ProvisionTenantResult>>;
}

/** Scaffold stub. Real implementation needs Supabase + Billing + audit wiring. */
export const tenantProvisioningService: TenantProvisioningService = {
  async provisionTenant() {
    throw new NotImplementedError("identityTenant.provisioning.provisionTenant");
  },
};
