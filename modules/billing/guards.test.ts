/**
 * modules/billing/guards.test.ts
 *
 * Pure guard-helper tests (technical-design §12). No DB or resolver: the guards
 * operate purely on an in-memory `Entitlements`, so these run against the plan
 * catalog directly — boundary checks for `requireWithinLimit` and the
 * unlocking-plan detail on both helpers' denials.
 */

import { describe, expect, it } from "vitest";

import { PLAN_ENTITLEMENTS } from "./plans";
import { requireCapability, requireWithinLimit } from "./guards";

describe("requireCapability", () => {
  it("passes when the capability is granted", () => {
    const ent = { ...PLAN_ENTITLEMENTS.plan_executive };
    const r = requireCapability(ent, "canUseBYOAgent");
    expect(r.ok).toBe(true);
  });

  it("denies with the unlocking plan when locked", () => {
    const ent = { ...PLAN_ENTITLEMENTS.plan_operator };
    const r = requireCapability(ent, "canUseRealtimeMonitoring");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("entitlement_denied");
      expect(r.error.detail?.reason).toBe("capability_locked");
      expect(r.error.detail?.needsPlan).toBe("plan_executive");
    }
  });
});

describe("requireWithinLimit", () => {
  const operator = { ...PLAN_ENTITLEMENTS.plan_operator }; // maxConnectedSources = 3

  it("passes below the limit", () => {
    expect(requireWithinLimit(operator, "maxConnectedSources", 2).ok).toBe(true);
  });

  it("passes exactly at the limit (current 2 + 1 = 3)", () => {
    expect(requireWithinLimit(operator, "maxConnectedSources", 2, 1).ok).toBe(true);
  });

  it("denies when the addition would exceed the limit", () => {
    const r = requireWithinLimit(operator, "maxConnectedSources", 3, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("entitlement_denied");
      expect(r.error.detail?.reason).toBe("limit_reached");
      expect(r.error.detail?.limit).toBe(3);
      expect(r.error.detail?.needsPlan).toBe("plan_executive");
    }
  });

  it("always passes for an unlimited (null) limit", () => {
    const enterprise = { ...PLAN_ENTITLEMENTS.plan_enterprise };
    expect(requireWithinLimit(enterprise, "maxConnectedSources", 10_000, 5).ok).toBe(true);
  });
});
