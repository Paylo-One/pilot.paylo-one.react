/**
 * modules/billing/entitlements.ts
 *
 * The entitlement RESOLVER: the one place that turns a tenant's subscription +
 * overrides + authoritative tenant access into the typed `Entitlements` contract
 * from `plans.ts`. Feature code never reads `tenants.plan` or the plan string
 * directly — it asks the resolver, then gates with the pure helpers in
 * `guards.ts` (`requireCapability` / `requireWithinLimit`).
 *
 * Resolution order (highest precedence last):
 *   tenant access  →  plan defaults  →  active add-ons  →  admin overrides
 *
 * Governance:
 *  - governance/docs/02-monetisation/billing-subscription-logical-design.md §7 (enforcement) + §8 (model)
 *  - governance/docs/02-monetisation/billing-subscription-technical-design.md §4 (engine) + §11 (rollout safety)
 *
 * Posture (mirrors model-usage-cost / model-entitlement): server-only. Reads go
 * through the secret client (service_role) with an EXPLICIT tenant_id predicate;
 * RLS is the database backstop, not the only guard. Decisions are server-side;
 * a client-supplied entitlement snapshot is never trusted for authorisation.
 *
 * Scaffold status: subscription + override resolution is wired to the new
 * tables; add-on resolution is a documented no-op until the add-on table lands
 * (Phase 5). During the Phase-1 backfill window a missing subscription row is
 * grandfathered to a default plan (observe-only), per technical-design §11.
 */

import "server-only";

import {
  AppError,
  err,
  ok,
  type Result,
  type TenantContext,
} from "@/modules/shared";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import {
  LOCKED_BASELINE,
  PLAN_ENTITLEMENTS,
  planEntitlements,
  type Entitlements,
  type PlanKey,
  type SubscriptionStatus,
} from "./plans";

/**
 * Default plan used to grandfather tenants that have no subscription row yet
 * (Phase-1 backfill window). Matches the stub's "treat every active workspace as
 * paying" behaviour so the resolver never locks out a current user. Replace with
 * the ops-chosen mapping once backfill completes.
 */
const GRANDFATHER_PLAN: PlanKey = "plan_executive";

/** The subscription fields the resolver needs. */
interface SubscriptionRow {
  readonly plan_key: PlanKey;
  readonly status: SubscriptionStatus;
}

interface OverrideRow {
  readonly entitlement_key: string;
  readonly value: unknown;
}

/**
 * Resolve the effective entitlements for a tenant. Always returns a value: a
 * tenant with no usable subscription resolves to a locked baseline (overlaid
 * with its real status), never an error — so callers gate, they don't crash.
 *
 * Accepts anything carrying a `tenantId` (the full `TenantContext`, or the
 * `{ tenantId }` available on server paths without a user session, e.g. OAuth
 * callbacks).
 */
export async function resolveEntitlements(
  ctx: Pick<TenantContext, "tenantId">,
): Promise<Result<Entitlements>> {
  try {
    const db = createSupabaseSecretClient();

    // 1. Most-recent subscription for the tenant (explicit tenant_id predicate;
    //    service_role bypasses RLS). Ordering + limit(1) fetches the current row
    //    without tripping over historical 'expired' rows (the partial unique
    //    index permits one live row alongside expired history).
    const { data: sub, error: subErr } = await db
      .from("tenant_subscriptions")
      .select("plan_key, status")
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<SubscriptionRow>();

    if (subErr) {
      return err(
        new AppError("internal", "Failed to read subscription", {
          tenantId: ctx.tenantId,
          cause: subErr.message,
        }),
      );
    }

    // 2. Tenant access is authoritative. Subscription/payment states are
    // operational signals only and never collapse product access by themselves.
    const { data: tenant, error: tenantErr } = await db
      .from("tenants")
      .select("status")
      .eq("id", ctx.tenantId)
      .maybeSingle<{ status: string }>();
    if (tenantErr) {
      return err(new AppError("internal", "Failed to read tenant access", {
        tenantId: ctx.tenantId,
        cause: tenantErr.message,
      }));
    }
    if (!tenant || tenant.status !== "active") {
      return ok({
        ...LOCKED_BASELINE,
        planKey: sub?.plan_key ?? GRANDFATHER_PLAN,
        status: "suspended",
      });
    }

    // No subscription row → grandfather during the backfill window (observe-only).
    if (!sub) {
      const ent = planEntitlements(GRANDFATHER_PLAN, "active");
      return ok(ent);
    }

    // 3. Plan defaults.
    let ent: Entitlements = { ...PLAN_ENTITLEMENTS[sub.plan_key], status: sub.status };

    // 4. Add-ons (Phase 5): no-op until the tenant add-on table exists.
    ent = applyAddOns(ent);

    // 5. Admin overrides (highest precedence among entitlement values).
    const { data: overrides, error: ovErr } = await db
      .from("tenant_entitlement_overrides")
      .select("entitlement_key, value")
      .eq("tenant_id", ctx.tenantId)
      .or("expires_at.is.null,expires_at.gt.now()");

    if (ovErr) {
      return err(
        new AppError("internal", "Failed to read entitlement overrides", {
          tenantId: ctx.tenantId,
          cause: ovErr.message,
        }),
      );
    }
    ent = applyOverrides(ent, (overrides ?? []) as OverrideRow[]);

    return ok(ent);
  } catch (cause) {
    return err(
      new AppError("internal", "Entitlement resolution failed", {
        tenantId: ctx.tenantId,
        cause: cause instanceof Error ? cause.message : String(cause),
      }),
    );
  }
}

/**
 * Apply purchased add-ons (extra sources, extra AI allowance, extra storage,
 * extra BYO agent slots). No-op until the add-on table lands in Phase 5; kept
 * as a seam so callers and the resolution order don't change later.
 */
function applyAddOns(ent: Entitlements): Entitlements {
  return ent;
}

/**
 * Overlay admin per-tenant overrides. Only known entitlement keys are applied,
 * and only when the override value's type matches the key's type — an
 * ill-typed override is ignored rather than corrupting the contract.
 */
function applyOverrides(ent: Entitlements, overrides: readonly OverrideRow[]): Entitlements {
  if (overrides.length === 0) return ent;
  const next: Record<string, unknown> = { ...ent };
  for (const { entitlement_key: key, value } of overrides) {
    if (!(key in ent)) continue; // unknown key → ignore
    const current = (ent as unknown as Record<string, unknown>)[key];
    // Allow null only where the existing value is a nullable numeric limit.
    if (value === null && (current === null || typeof current === "number")) {
      next[key] = null;
    } else if (typeof current === typeof value) {
      next[key] = value;
    }
    // type mismatch → ignore the override
  }
  return next as unknown as Entitlements;
}
