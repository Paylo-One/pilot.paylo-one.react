/**
 * modules/billing/guards.ts
 *
 * Pure guard helpers — the uniform way callers enforce a capability or a numeric
 * limit against a resolved `Entitlements`. They operate ONLY on the in-memory
 * entitlement object (no DB, no `server-only`), so they are importable anywhere:
 * server actions enforce with them, and client components may mirror the same
 * checks for UX (the server remains authoritative — see entitlements.ts).
 *
 * On denial both return the shared `Err` with `code: 'entitlement_denied'` and a
 * `detail` payload (`EntitlementDenial`) naming the plan that unlocks the
 * capability/limit, so the UI renders the correct upgrade prompt.
 *
 * Governance: governance/docs/02-monetisation/billing-subscription-logical-design.md §7-8, technical-design §4.3.
 */

import { AppError, err, ok, type Result } from "@/modules/shared";
import {
  PLAN_ENTITLEMENTS,
  type CapabilityKey,
  type Entitlements,
  type LimitKey,
  type PlanKey,
} from "./plans";

/** Detail attached to an entitlement denial so the UI can render an upgrade CTA. */
export interface EntitlementDenial {
  readonly reason: "capability_locked" | "limit_reached";
  readonly key: string;
  /** The lowest plan that grants this capability/limit headroom, if any. */
  readonly needsPlan?: PlanKey;
  readonly limit?: number | null;
  readonly current?: number;
}

function denial(detail: EntitlementDenial): AppError {
  return new AppError("entitlement_denied", `Upgrade required: ${detail.key}`, {
    ...detail,
  });
}

/** Lowest-rank plan whose default grants the given capability, if any. */
function lowestPlanWithCapability(key: CapabilityKey): PlanKey | undefined {
  const order: PlanKey[] = ["plan_operator", "plan_executive", "plan_command", "plan_enterprise"];
  return order.find((p) => PLAN_ENTITLEMENTS[p][key] === true);
}

/** Lowest-rank plan whose default limit exceeds `current`, if any. */
function lowestPlanWithLimitHeadroom(key: LimitKey, current: number): PlanKey | undefined {
  const order: PlanKey[] = ["plan_operator", "plan_executive", "plan_command", "plan_enterprise"];
  return order.find((p) => {
    const lim = PLAN_ENTITLEMENTS[p][key];
    return lim === null || lim > current;
  });
}

/**
 * Require a boolean capability. `Ok` when granted; `Err(entitlement_denied)`
 * with the unlocking plan otherwise.
 */
export function requireCapability(
  ent: Entitlements,
  key: CapabilityKey,
): Result<void> {
  if (ent[key] === true) return ok(undefined);
  return err(
    denial({ reason: "capability_locked", key, needsPlan: lowestPlanWithCapability(key) }),
  );
}

/**
 * Require headroom under a numeric limit before creating `delta` more of
 * something. `null` limit = unlimited. `Ok` when `current + delta <= limit`.
 */
export function requireWithinLimit(
  ent: Entitlements,
  key: LimitKey,
  current: number,
  delta = 1,
): Result<void> {
  const limit = ent[key];
  if (limit === null) return ok(undefined); // unlimited
  if (current + delta <= limit) return ok(undefined);
  return err(
    denial({
      reason: "limit_reached",
      key,
      limit,
      current,
      needsPlan: lowestPlanWithLimitHeadroom(key, current + delta - 1),
    }),
  );
}
