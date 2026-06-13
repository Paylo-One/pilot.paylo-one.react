import "server-only";

/**
 * modules/source-connection/entitlement-guard.ts
 *
 * Plan enforcement for connecting sources — the first wired enforcement point
 * (governance/billing-logical-design.md §7.2, technical-design §8, §11).
 *
 * OBSERVE-ONLY for now: we resolve the tenant's `maxConnectedSources`
 * entitlement, count their current connections, and check headroom — but a
 * denial is only LOGGED, never enforced. This is the safe rollout posture from
 * technical-design §11: ship the gate, watch the would-block logs, and flip
 * `ENFORCE` to `true` per-capability once the logs are clean. Flipping to
 * blocking is then a one-line change here, not a rewrite of the callers.
 *
 * Counting uses the SECRET client with an explicit tenant_id predicate so the
 * count is correct from both the operator (RLS) path and the credential-less
 * OAuth-callback path. The decision is centralised so both source-creation
 * paths (`ensureSourceConnection`, `upsertProviderConnection`) gate identically.
 */

import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { resolveEntitlements, requireWithinLimit } from "@/modules/billing";

/**
 * Master switch for THIS capability's enforcement. `false` = observe-only (log
 * the would-block, allow the action). Flip to `true` to actually block once the
 * observe-only logs across tenants look right.
 */
const ENFORCE = false;

/** Count the tenant's existing source connections (the limit's denominator). */
async function countSourceConnections(tenantId: string): Promise<number> {
  const secret = createSupabaseSecretClient();
  const { count, error } = await secret
    .from("source_connections")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * Gate the creation of a NEW source connection against `maxConnectedSources`.
 *
 * Call this ONLY when about to create a genuinely new connection (i.e. after a
 * find step found no existing row for the system) — reconnecting an existing
 * source must never be blocked.
 *
 * Returns `true` when the caller may proceed. In observe-only mode it always
 * returns `true`, logging `[billing][observe]` when the action WOULD have been
 * blocked. When `ENFORCE` is on, it returns `false` on a denial so the caller
 * can surface an upgrade-required path. Resolution/count failures fail OPEN
 * (allow + log) so a billing hiccup never breaks connecting a source.
 */
export async function checkCanAddSourceConnection(opts: {
  tenantId: string;
  system: string;
}): Promise<boolean> {
  try {
    const resolved = await resolveEntitlements({ tenantId: opts.tenantId });
    if (!resolved.ok) {
      console.warn(
        "[billing][observe] maxConnectedSources: entitlement resolution failed; allowing (fail-open)",
        { tenantId: opts.tenantId, system: opts.system, error: resolved.error.code },
      );
      return true;
    }

    const current = await countSourceConnections(opts.tenantId);
    const decision = requireWithinLimit(
      resolved.value,
      "maxConnectedSources",
      current,
      1,
    );

    if (decision.ok) return true;

    // Denied by the plan limit.
    const detail = decision.error.detail ?? {};
    if (ENFORCE) {
      console.warn("[billing][enforce] maxConnectedSources: blocked new connection", {
        tenantId: opts.tenantId,
        system: opts.system,
        current,
        ...detail,
      });
      return false;
    }

    console.warn(
      "[billing][observe] maxConnectedSources: WOULD block new connection (observe-only; allowing)",
      {
        tenantId: opts.tenantId,
        system: opts.system,
        current,
        ...detail,
      },
    );
    return true;
  } catch (cause) {
    // Never let a billing check break source connection — fail open + log.
    console.warn(
      "[billing][observe] maxConnectedSources: check errored; allowing (fail-open)",
      {
        tenantId: opts.tenantId,
        system: opts.system,
        error: cause instanceof Error ? cause.message : String(cause),
      },
    );
    return true;
  }
}
