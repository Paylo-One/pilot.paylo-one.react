/**
 * modules/billing/paddle-status.ts
 *
 * Pure Paddle status vocabulary + access helper. Dependency-free on purpose
 * (unit-tested without any server context; safe to import anywhere).
 *
 * ADR-053 posture: `tenants.status` is the SOLE access authority. Everything
 * here is an OPERATIONAL SIGNAL about the payment relationship — it must never
 * be used to suspend a tenant, and webhook handlers never mutate
 * `tenants.status`.
 */

/** Paddle subscription statuses (closed set, per @paddle/paddle-node-sdk). */
export type PaddleSubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "paused";

/** Scheduled change actions Paddle can announce ahead of time. */
export type PaddleScheduledChangeAction = "cancel" | "pause" | "resume";

export interface PaddleScheduledChange {
  readonly action: PaddleScheduledChangeAction;
  readonly effectiveAt: string;
  readonly resumeAt?: string | null;
}

/**
 * Map a Paddle subscription status into the EXISTING tenant_subscriptions
 * vocabulary (no new states were added for Paddle):
 *
 *  - trialing → trialing
 *  - active   → active
 *  - past_due → past_due   (banner-only; access retained per ADR-053 posture)
 *  - canceled → cancelled  (repo keeps the provider-agnostic spelling)
 *  - paused   → suspended  (DELIBERATE: the check constraint has no 'paused';
 *                           'suspended' is the closest existing state that,
 *                           like a Paddle pause, is non-terminal, reversible,
 *                           and does not grant access. 'grace' was rejected
 *                           because it grants access; 'cancelled'/'expired'
 *                           because they read as terminal.)
 *
 * Unknown values collapse to 'suspended' (non-terminal, no access) so a new
 * Paddle status can never silently grant access.
 */
export function mapPaddleSubscriptionStatus(
  status: string,
): "trialing" | "active" | "past_due" | "cancelled" | "suspended" {
  switch (status as PaddleSubscriptionStatus) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
      return "cancelled";
    case "paused":
      return "suspended";
    default:
      return "suspended";
  }
}

/**
 * Whether a subscription's payment state grants product access. Pure signal —
 * `tenants.status` remains the sole access authority (ADR-053); callers layer
 * this on top, never the other way round.
 *
 * Truth table:
 *  - `active`, `trialing`               → grant.
 *  - `past_due`                         → grant (banner-only; dunning runs its
 *                                         course before anything changes).
 *  - `grace`                            → grant (existing internal state).
 *  - `canceled`/`cancelled`, `expired`,
 *    `paused`/`suspended`, anything else → no grant.
 *  - A scheduled change (even action 'cancel' or 'pause') NEVER revokes by
 *    itself: until Paddle applies it and sends the resulting status, the
 *    subscription keeps whatever its current status grants.
 *
 * Accepts both the raw Paddle spelling ('canceled', 'paused') and the internal
 * tenant_subscriptions spelling ('cancelled', 'suspended').
 */
export function subscriptionGrantsAccess(
  status: string,
  _scheduledChange?: PaddleScheduledChange | null,
): boolean {
  switch (status) {
    case "active":
    case "trialing":
    case "past_due":
    case "grace":
      return true;
    default:
      return false;
  }
}
