/**
 * modules/billing/entitlements.test.ts
 *
 * Resolver + guard tests (technical-design §12). The Supabase secret client is
 * mocked so the resolver runs against fixture rows: we exercise the resolution
 * order (plan defaults → overrides → account-state), the grandfather path,
 * read-error handling, ill-typed override rejection, and the guard helpers.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TenantContext } from "@/modules/shared";
import {
  PLAN_ENTITLEMENTS,
  type Entitlements,
  type PlanKey,
  type SubscriptionStatus,
} from "./plans";

// --- mock the secret Supabase client --------------------------------------
// `vi.hoisted` so the holder exists before the hoisted `vi.mock` factory runs.
const { dbHolder } = vi.hoisted(() => ({
  dbHolder: { current: null as unknown as ReturnType<typeof makeMockDb> },
}));

vi.mock("@/lib/supabase/secret", () => ({
  createSupabaseSecretClient: () => dbHolder.current,
}));

// Imported AFTER the mock is registered.
import { resolveEntitlements } from "./entitlements";

// --- mock query builder -----------------------------------------------------
interface TableResult {
  single?: { data: unknown; error: { message: string } | null };
  list?: { data: unknown; error: { message: string } | null };
}
type DbConfig = Record<string, TableResult>;

function makeMockDb(config: DbConfig) {
  return {
    from(table: string) {
      const result = config[table] ?? {};
      const single = result.single ?? { data: null, error: null };
      const list = result.list ?? { data: [], error: null };
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        // terminal for the subscription query
        maybeSingle: () => Promise.resolve(single),
        // terminal for the overrides query (`await db.from()...or(...)`)
        or: () => Promise.resolve(list),
      };
      return builder;
    },
  };
}

const CTX: TenantContext = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  tenantSlug: "acme",
  userId: "22222222-2222-2222-2222-222222222222",
  role: "owner",
};

function withDb(config: DbConfig) {
  dbHolder.current = makeMockDb(config);
}

function subRow(plan_key: string, status: SubscriptionStatus) {
  return { single: { data: { plan_key, status }, error: null } };
}

async function resolveOrThrow(): Promise<Entitlements> {
  const r = await resolveEntitlements(CTX);
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.value;
}

beforeEach(() => {
  withDb({});
});

describe("resolveEntitlements — plan defaults", () => {
  it("returns the plan's defaults for an active subscription", async () => {
    withDb({ tenant_subscriptions: subRow("plan_command", "active") });
    const ent = await resolveOrThrow();
    expect(ent.planKey).toBe("plan_command");
    expect(ent.status).toBe("active");
    expect(ent.maxConnectedSources).toBe(PLAN_ENTITLEMENTS.plan_command.maxConnectedSources);
    expect(ent.canUseRealtimeMonitoring).toBe(true);
    expect(ent.monitoringFrequency).toBe("near_real_time");
  });

  it("carries the subscription status onto the entitlements", async () => {
    withDb({ tenant_subscriptions: subRow("plan_operator", "trialing") });
    const ent = await resolveOrThrow();
    expect(ent.planKey).toBe("plan_operator");
    expect(ent.status).toBe("trialing");
    expect(ent.canUseBYOAgent).toBe(false);
  });

  it("treats Enterprise null limits as unlimited", async () => {
    withDb({ tenant_subscriptions: subRow("plan_enterprise", "active") });
    const ent = await resolveOrThrow();
    expect(ent.maxConnectedSources).toBeNull();
    expect(ent.monthlyAiTokenAllowance).toBeNull();
    expect(ent.canUsePrivateInference).toBe(true);
  });
});

describe("resolveEntitlements — account state", () => {
  it("collapses a suspended subscription to the locked baseline (plan + status preserved)", async () => {
    withDb({ tenant_subscriptions: subRow("plan_command", "suspended") });
    const ent = await resolveOrThrow();
    expect(ent.status).toBe("suspended");
    expect(ent.planKey).toBe("plan_command");
    expect(ent.canCreateActions).toBe(false);
    expect(ent.canUseRealtimeMonitoring).toBe(false);
    expect(ent.maxConnectedSources).toBe(0);
    expect(ent.monthlyAiTokenAllowance).toBe(0);
  });

  it("collapses an expired subscription to the locked baseline", async () => {
    withDb({ tenant_subscriptions: subRow("plan_executive", "expired") });
    const ent = await resolveOrThrow();
    expect(ent.status).toBe("expired");
    expect(ent.canUseBYOAgent).toBe(false);
    expect(ent.maxBriefingsPerDay).toBe(0);
  });

  it("collapses past_due to the locked baseline", async () => {
    withDb({ tenant_subscriptions: subRow("plan_executive", "past_due") });
    const ent = await resolveOrThrow();
    expect(ent.maxConnectedSources).toBe(0);
    expect(ent.canCreateActions).toBe(false);
  });

  it("collapses grace to the locked baseline", async () => {
    withDb({ tenant_subscriptions: subRow("plan_command", "grace") });
    const ent = await resolveOrThrow();
    expect(ent.maxConnectedSources).toBe(0);
    expect(ent.canUseRealtimeMonitoring).toBe(false);
  });

  it("collapses cancelled to the locked baseline", async () => {
    withDb({ tenant_subscriptions: subRow("plan_executive", "cancelled") });
    const ent = await resolveOrThrow();
    expect(ent.maxConnectedSources).toBe(0);
    expect(ent.canUseBYOAgent).toBe(false);
  });

  it("collapses unpaid and incomplete to the locked baseline", async () => {
    withDb({ tenant_subscriptions: subRow("plan_executive", "unpaid") });
    const unpaid = await resolveOrThrow();
    expect(unpaid.maxConnectedSources).toBe(0);

    withDb({ tenant_subscriptions: subRow("plan_executive", "incomplete") });
    const incomplete = await resolveOrThrow();
    expect(incomplete.canCreateActions).toBe(false);
  });
});

describe("resolveEntitlements — grandfather + errors", () => {
  it("grandfathers a tenant with no subscription row to plan_executive/active", async () => {
    withDb({}); // no row
    const ent = await resolveOrThrow();
    expect(ent.planKey).toBe("plan_executive");
    expect(ent.status).toBe("active");
  });

  it("returns an internal error when the subscription read fails", async () => {
    withDb({ tenant_subscriptions: { single: { data: null, error: { message: "boom" } } } });
    const r = await resolveEntitlements(CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("internal");
  });

  it("returns an internal error when the override read fails", async () => {
    withDb({
      tenant_subscriptions: subRow("plan_executive", "active"),
      tenant_entitlement_overrides: { list: { data: null, error: { message: "boom" } } },
    });
    const r = await resolveEntitlements(CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("internal");
  });
});

describe("resolveEntitlements — overrides", () => {
  it("applies a valid numeric override over the plan default", async () => {
    withDb({
      tenant_subscriptions: subRow("plan_operator", "active"),
      tenant_entitlement_overrides: {
        list: { data: [{ entitlement_key: "maxConnectedSources", value: 25 }], error: null },
      },
    });
    const ent = await resolveOrThrow();
    expect(ent.maxConnectedSources).toBe(25); // overrides Operator's default of 3
  });

  it("applies a boolean capability override", async () => {
    withDb({
      tenant_subscriptions: subRow("plan_operator", "active"),
      tenant_entitlement_overrides: {
        list: { data: [{ entitlement_key: "canUseRealtimeMonitoring", value: true }], error: null },
      },
    });
    const ent = await resolveOrThrow();
    expect(ent.canUseRealtimeMonitoring).toBe(true);
  });

  it("accepts null to make a numeric limit unlimited", async () => {
    withDb({
      tenant_subscriptions: subRow("plan_operator", "active"),
      tenant_entitlement_overrides: {
        list: { data: [{ entitlement_key: "maxConnectedSources", value: null }], error: null },
      },
    });
    const ent = await resolveOrThrow();
    expect(ent.maxConnectedSources).toBeNull();
  });

  it("ignores unknown override keys", async () => {
    withDb({
      tenant_subscriptions: subRow("plan_operator", "active"),
      tenant_entitlement_overrides: {
        list: { data: [{ entitlement_key: "totallyMadeUp", value: 999 }], error: null },
      },
    });
    const ent = await resolveOrThrow();
    expect((ent as unknown as Record<string, unknown>).totallyMadeUp).toBeUndefined();
    expect(ent.maxConnectedSources).toBe(3);
  });

  it("ignores type-mismatched overrides (boolean for a numeric limit)", async () => {
    withDb({
      tenant_subscriptions: subRow("plan_operator", "active"),
      tenant_entitlement_overrides: {
        list: { data: [{ entitlement_key: "maxConnectedSources", value: true }], error: null },
      },
    });
    const ent = await resolveOrThrow();
    expect(ent.maxConnectedSources).toBe(3); // untouched
  });

  it("does not apply overrides once collapsed by a suspended state", async () => {
    withDb({
      tenant_subscriptions: subRow("plan_command", "suspended"),
      tenant_entitlement_overrides: {
        list: { data: [{ entitlement_key: "canUseRealtimeMonitoring", value: true }], error: null },
      },
    });
    const ent = await resolveOrThrow();
    // suspended short-circuits to the locked baseline before overrides are read
    expect(ent.canUseRealtimeMonitoring).toBe(false);
  });
});

describe("plan catalog — monotonicity sanity (technical-design §12)", () => {
  const pairs: Array<[PlanKey, PlanKey]> = [
    ["plan_operator", "plan_executive"],
    ["plan_executive", "plan_command"],
  ];
  const numericKeys: Array<keyof Entitlements> = [
    "maxConnectedSources",
    "maxBriefingsPerDay",
    "maxPeopleRecords",
    "maxAutomations",
    "maxKnowledgeBaseStorageMb",
    "maxFileUploadsPerMonth",
    "monthlyAiTokenAllowance",
    "dataRetentionDays",
  ];

  it("numeric limits are non-decreasing Operator → Executive → Command", () => {
    for (const [loKey, hiKey] of pairs) {
      for (const key of numericKeys) {
        const lo = PLAN_ENTITLEMENTS[loKey][key] as number | null;
        const hi = PLAN_ENTITLEMENTS[hiKey][key] as number | null;
        // null = unlimited = highest; only compare when both finite
        if (lo !== null && hi !== null) {
          expect(hi, `${key}: ${hiKey} >= ${loKey}`).toBeGreaterThanOrEqual(lo);
        }
      }
    }
  });

  it("availableSyncFrequencies always includes 'daily' and is monotonic (ADR-043)", () => {
    const allPlans: PlanKey[] = [
      "plan_operator",
      "plan_executive",
      "plan_command",
      "plan_enterprise",
    ];
    for (const planKey of allPlans) {
      expect(PLAN_ENTITLEMENTS[planKey].availableSyncFrequencies).toContain("daily");
    }
    // Each tier's set is a superset of the one below.
    for (const [loKey, hiKey] of pairs) {
      const lo = PLAN_ENTITLEMENTS[loKey].availableSyncFrequencies;
      const hi = PLAN_ENTITLEMENTS[hiKey].availableSyncFrequencies;
      for (const f of lo) {
        expect(hi, `${hiKey} ⊇ ${loKey}`).toContain(f);
      }
    }
    // Operator (entry tier) is daily-only; Executive unlocks the custom set.
    expect(PLAN_ENTITLEMENTS.plan_operator.availableSyncFrequencies).toEqual(["daily"]);
    expect(PLAN_ENTITLEMENTS.plan_executive.availableSyncFrequencies.length).toBeGreaterThan(1);
  });
});
