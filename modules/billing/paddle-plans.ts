/**
 * modules/billing/paddle-plans.ts
 *
 * Env-driven mapping from configured Paddle price IDs to the public tiers the
 * marketing site sells (Starter/Pro/Advanced, monthly+annual). Variable names
 * mirror the marketing repo's lib/billing/paddle-config.ts so the two surfaces
 * never drift.
 *
 * TODO(plan-keys): the commercial spec introduces plan_starter/plan_pro/
 * plan_advanced, but those plan keys do NOT exist in modules/billing/plans.ts
 * or subscription_plans yet (out of scope for the fulfilment layer). Because
 * tenant_subscriptions.plan_key is NOT NULL and references subscription_plans,
 * Paddle tiers are PROVISIONALLY mapped onto the legacy keys by tier rank
 * (starter→plan_operator, pro→plan_executive, advanced→plan_command). Replace
 * this mapping when the new plan keys land.
 */

import type { PlanKey } from "./plans";

export type PaddleBillingTierKey = "starter" | "pro" | "advanced";
export type PaddleBillingInterval = "monthly" | "annual";

export interface PaddlePriceOption {
  readonly key: `${PaddleBillingTierKey}_${PaddleBillingInterval}`;
  readonly tierKey: PaddleBillingTierKey;
  readonly interval: PaddleBillingInterval;
  /** Env var carrying the configured Paddle price id (pri_...). */
  readonly priceEnv: string;
}

export const PADDLE_PRICE_OPTIONS: readonly PaddlePriceOption[] = [
  { key: "starter_monthly", tierKey: "starter", interval: "monthly", priceEnv: "PADDLE_PRICE_STARTER_MONTHLY" },
  { key: "starter_annual", tierKey: "starter", interval: "annual", priceEnv: "PADDLE_PRICE_STARTER_ANNUAL" },
  { key: "pro_monthly", tierKey: "pro", interval: "monthly", priceEnv: "PADDLE_PRICE_PRO_MONTHLY" },
  { key: "pro_annual", tierKey: "pro", interval: "annual", priceEnv: "PADDLE_PRICE_PRO_ANNUAL" },
  { key: "advanced_monthly", tierKey: "advanced", interval: "monthly", priceEnv: "PADDLE_PRICE_ADVANCED_MONTHLY" },
  { key: "advanced_annual", tierKey: "advanced", interval: "annual", priceEnv: "PADDLE_PRICE_ADVANCED_ANNUAL" },
];

/**
 * TODO(plan-keys): provisional tier→plan_key bridge until plan_starter/
 * plan_pro/plan_advanced exist (see file header). Chosen by tier rank only.
 */
const PROVISIONAL_TIER_PLAN_KEY: Record<PaddleBillingTierKey, PlanKey> = {
  starter: "plan_operator",
  pro: "plan_executive",
  advanced: "plan_command",
};

export interface ConfiguredPaddlePlan {
  readonly tierKey: PaddleBillingTierKey;
  readonly interval: PaddleBillingInterval;
  readonly priceOption: PaddlePriceOption;
  /** TODO(plan-keys): provisional — see PROVISIONAL_TIER_PLAN_KEY. */
  readonly planKey: PlanKey;
}

/** Resolve a Paddle price id back to the configured tier, or null if unknown. */
export function paddlePlanFromPriceId(
  priceId: string | null | undefined,
): ConfiguredPaddlePlan | null {
  if (!priceId) return null;
  for (const option of PADDLE_PRICE_OPTIONS) {
    const configured = process.env[option.priceEnv]?.trim();
    if (configured && configured === priceId) {
      return {
        tierKey: option.tierKey,
        interval: option.interval,
        priceOption: option,
        planKey: PROVISIONAL_TIER_PLAN_KEY[option.tierKey],
      };
    }
  }
  return null;
}

/**
 * Plan key persisted for a Paddle subscription. Unknown price ids fall back to
 * the lowest tier so the NOT NULL plan_key column is always satisfiable.
 * TODO(plan-keys): revisit alongside PROVISIONAL_TIER_PLAN_KEY.
 */
export function paddlePlanKeyForPriceId(priceId: string | null | undefined): PlanKey {
  return paddlePlanFromPriceId(priceId)?.planKey ?? "plan_operator";
}
