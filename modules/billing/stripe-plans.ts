import type { PlanKey } from "./plans";

export type StripeBillingTierKey = "operator" | "executive";
export type StripeBillingInterval = "monthly" | "annual";

export interface StripeBillingTier {
  readonly key: StripeBillingTierKey;
  readonly planKey: PlanKey;
  readonly name: string;
  readonly summary: string;
  readonly productEnv: string;
}

export interface StripeBillingPriceOption {
  readonly key: `${StripeBillingTierKey}_${StripeBillingInterval}`;
  readonly tierKey: StripeBillingTierKey;
  readonly interval: StripeBillingInterval;
  readonly label: string;
  readonly displayPrice: string;
  readonly displayCadence: string;
  readonly priceEnv: string;
}

export const STRIPE_BILLING_TIERS: readonly StripeBillingTier[] = [
  {
    key: "operator",
    planKey: "plan_operator",
    name: "Personal Operator",
    summary: "Core workspace, daily briefings, diary, actions, and essential sources.",
    productEnv: "STRIPE_PRODUCT_BASIC",
  },
  {
    key: "executive",
    planKey: "plan_executive",
    name: "Executive Operator",
    summary: "More sources, custom schedules, richer people context, and priority workflows.",
    productEnv: "STRIPE_PRODUCT_EXECUTIVE",
  },
] as const;

export const STRIPE_BILLING_PRICE_OPTIONS: readonly StripeBillingPriceOption[] = [
  {
    key: "operator_monthly",
    tierKey: "operator",
    interval: "monthly",
    label: "Personal monthly",
    displayPrice: "€49",
    displayCadence: "per month",
    priceEnv: "STRIPE_PRICE_BASIC_MONTHLY",
  },
  {
    key: "operator_annual",
    tierKey: "operator",
    interval: "annual",
    label: "Personal annual",
    displayPrice: "€490",
    displayCadence: "per year",
    priceEnv: "STRIPE_PRICE_BASIC_ANNUAL",
  },
  {
    key: "executive_monthly",
    tierKey: "executive",
    interval: "monthly",
    label: "Executive monthly",
    displayPrice: "€149",
    displayCadence: "per month",
    priceEnv: "STRIPE_PRICE_EXECUTIVE_MONTHLY",
  },
  {
    key: "executive_annual",
    tierKey: "executive",
    interval: "annual",
    label: "Executive annual",
    displayPrice: "€1,490",
    displayCadence: "per year",
    priceEnv: "STRIPE_PRICE_EXECUTIVE_ANNUAL",
  },
] as const;

export function stripeTierForKey(key: string | null | undefined): StripeBillingTier | null {
  return STRIPE_BILLING_TIERS.find((tier) => tier.key === key) ?? null;
}

export function stripeTierForPlanKey(planKey: string | null | undefined): StripeBillingTier | null {
  return STRIPE_BILLING_TIERS.find((tier) => tier.planKey === planKey) ?? null;
}

export function stripePriceOptionForKey(
  key: string | null | undefined,
): StripeBillingPriceOption | null {
  return STRIPE_BILLING_PRICE_OPTIONS.find((option) => option.key === key) ?? null;
}

export function stripePriceOptionForTierAndInterval(
  tierKey: StripeBillingTierKey,
  interval: StripeBillingInterval,
): StripeBillingPriceOption | null {
  return (
    STRIPE_BILLING_PRICE_OPTIONS.find(
      (option) => option.tierKey === tierKey && option.interval === interval,
    ) ?? null
  );
}
