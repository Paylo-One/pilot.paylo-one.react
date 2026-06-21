/**
 * Billing status vocabulary for Stripe-backed access control.
 *
 * `tenant_subscriptions.status` keeps the older provider-agnostic spelling
 * `cancelled`; the user-facing/access projection uses Stripe's `canceled`.
 */

export const BILLING_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "canceled",
  "incomplete",
  "expired",
] as const;

export type BillingStatus = (typeof BILLING_STATUSES)[number];

export const ACCESS_STATUSES = ["active", "restricted"] as const;
export type BillingAccessStatus = (typeof ACCESS_STATUSES)[number];

export type StripeSubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

export function mapStripeSubscriptionStatus(status: string): {
  billingStatus: BillingStatus;
  accessStatus: BillingAccessStatus;
} {
  switch (status as StripeSubscriptionStatus) {
    case "active":
      return { billingStatus: "active", accessStatus: "active" };
    case "trialing":
      return { billingStatus: "trialing", accessStatus: "active" };
    case "past_due":
      return { billingStatus: "past_due", accessStatus: "restricted" };
    case "unpaid":
      return { billingStatus: "unpaid", accessStatus: "restricted" };
    case "canceled":
      return { billingStatus: "canceled", accessStatus: "restricted" };
    case "incomplete":
      return { billingStatus: "incomplete", accessStatus: "restricted" };
    case "incomplete_expired":
      return { billingStatus: "expired", accessStatus: "restricted" };
    default:
      return { billingStatus: "incomplete", accessStatus: "restricted" };
  }
}

export function tenantSubscriptionStatus(status: BillingStatus) {
  if (status === "canceled") return "cancelled";
  if (status === "unpaid" || status === "incomplete") return status;
  return status;
}

export function isBillingAccessAllowed(status: BillingAccessStatus): boolean {
  return status === "active";
}
