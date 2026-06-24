/**
 * plan-content.ts
 *
 * Presentation copy for the Billing plan comparison. This mirrors the public
 * pricing language on paylo.one (site/lib/pricing.ts) but is scoped to the two
 * plans the workspace can actually subscribe to via Stripe — the simple
 * "Personal Operator" tier and the "Executive Operator" tier. Pricing and
 * checkout themselves come from modules/billing/stripe-plans; this file only
 * carries the audience line, the included-features bullets, and the
 * what-is-included comparison matrix. Edit copy here.
 */

import type { StripeBillingTierKey } from "@/modules/billing/stripe-plans";

export interface PlanContent {
  /** Who the tier is for. */
  audience: string;
  /** Mono access label rendered as a tag on the card. */
  accessTag: string;
  /** Bullet list of what is included. */
  includes: string[];
  /** Emphasise this tier as the recommended path. */
  featured?: boolean;
}

export const PLAN_CONTENT: Record<StripeBillingTierKey, PlanContent> = {
  operator: {
    audience: "For individual leaders.",
    accessTag: "Simple",
    includes: [
      "Single-user workspace",
      "Personal subdomain",
      "Daily briefing",
      "Actions",
      "Diary",
      "Core integrations",
      "Source references on every insight",
      "Basic retention controls",
    ],
  },
  executive: {
    audience: "For high-context leaders who want deeper setup and support.",
    accessTag: "Recommended",
    includes: [
      "Everything in Personal Operator",
      "Paid, hands-on onboarding",
      "Advanced integrations",
      "Extended retention controls",
      "Higher source volume",
      "Priority briefing generation",
      "Higher AI usage allowance",
      "Advanced follow-up settings",
    ],
    featured: true,
  },
};

export interface PlanMatrixRow {
  feature: string;
  /** [Personal Operator, Executive Operator] — column order matches the cards. */
  values: [string | boolean, string | boolean];
}

export const PLAN_MATRIX: PlanMatrixRow[] = [
  { feature: "Daily briefing", values: [true, "Priority"] },
  { feature: "Actions", values: [true, true] },
  { feature: "Diary", values: [true, true] },
  { feature: "Integrations", values: ["Core", "Advanced"] },
  { feature: "Personal subdomain", values: [true, true] },
  { feature: "Source references", values: [true, true] },
  { feature: "Source volume", values: ["Standard", "Higher"] },
  { feature: "Data retention controls", values: ["Basic", "Extended"] },
  { feature: "AI usage allowance", values: ["Standard", "Higher"] },
  { feature: "Connected service controls", values: [false, "Assisted setup"] },
  { feature: "Onboarding support", values: ["Self-serve", "Paid onboarding"] },
  { feature: "Support level", values: ["Standard", "Priority"] },
];
