/**
 * modules/billing — subscription state and the entitlement engine tied to the
 * workspace (tenant). The public surface other modules consume.
 *
 * Source of truth for entitlement *shape and defaults* is `plans.ts`
 * (dependency-free, also imported by the admin portal and marketing site). The
 * server-side resolver and guard helpers live in `entitlements.ts`.
 *
 * Governance:
 *  - governance/billing-logical-design.md (tiers, matrix, lifecycle, enforcement)
 *  - governance/billing-technical-design.md (data model, engine, APIs)
 *  - services/billing.md (provider integration; invite-linked activation)
 *
 * Still a stub on the money side: no payment provider, no webhooks, no
 * checkout. Subscription state is read from `tenant_subscriptions`; during the
 * Phase-1 backfill window a tenant with no row is grandfathered to a default
 * plan so nothing locks out (see entitlements.ts + technical-design §11).
 */

import "server-only";

import { ok, type Result, type TenantContext } from "@/modules/shared";
import { resolveEntitlements } from "./entitlements";
import type { SubscriptionStatus } from "./plans";

// Re-export the entitlement contract + catalog (the shared surface).
export type {
  PlanKey,
  SubscriptionStatus,
  Entitlements,
  CapabilityKey,
  LimitKey,
  MonitoringFrequency,
  SyncFrequency,
  SupportLevel,
  AdminControlsLevel,
} from "./plans";
export {
  PLAN_ENTITLEMENTS,
  LOCKED_BASELINE,
  PLAN_RANK,
  isHigherTier,
  planEntitlements,
} from "./plans";

// Re-export the resolver.
export { resolveEntitlements } from "./entitlements";

// Re-export the pure guard helpers.
export {
  requireCapability,
  requireWithinLimit,
  type EntitlementDenial,
} from "./guards";
export {
  mapStripeSubscriptionStatus,
  isBillingAccessAllowed,
  type BillingStatus,
  type BillingAccessStatus,
} from "./status";

/**
 * The billing service surface. `getStatus` is preserved for existing callers
 * but now derives the status from the resolved entitlements rather than a
 * hard-coded constant.
 */
export interface BillingService {
  /** The tenant's current subscription status. */
  getStatus(ctx: TenantContext): Promise<Result<{ status: SubscriptionStatus }>>;
}

export const billingService: BillingService = {
  async getStatus(ctx) {
    const resolved = await resolveEntitlements(ctx);
    if (!resolved.ok) return resolved;
    return ok({ status: resolved.value.status });
  },
};
