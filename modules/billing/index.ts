/**
 * modules/billing — invite-linked paid activation, subscription state, and
 * entitlement tied to the workspace. Governance: services/billing.md.
 *
 * NOT THE FOCUS THIS PASS. Coherent typed stub: no payment provider, no
 * webhooks, no entitlement persistence yet. For the local build every active
 * workspace is treated as a paying customer, so `getStatus` returns a static
 * 'active'. Real invite validation, Stripe-hosted checkout and webhook-driven
 * reconciliation land in a later pass.
 */

import { ok, type Result, type TenantContext } from "@/modules/shared";

export type SubscriptionStatus = "none" | "active" | "past_due" | "suspended";

export interface BillingService {
  getStatus(ctx: TenantContext): Promise<Result<{ status: SubscriptionStatus }>>;
}

export const billingService: BillingService = {
  async getStatus() {
    // Static 'active' for the local build; no provider integration yet.
    return ok({ status: "active" });
  },
};
