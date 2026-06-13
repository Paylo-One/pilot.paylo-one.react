/**
 * entitlement-guard.test.ts — observe-only maxConnectedSources enforcement.
 *
 * The billing resolver is mocked (we drive the entitlement directly) and the
 * secret client returns a fixed connection count. We assert the OBSERVE-ONLY
 * contract: the guard always allows, but logs a `[billing][observe]` would-block
 * when the plan limit is exceeded, and fails OPEN on resolver/count errors.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ok, err, AppError } from "@/modules/shared";
import { PLAN_ENTITLEMENTS } from "@/modules/billing/plans";

const { resolveMock } = vi.hoisted(() => ({ resolveMock: vi.fn() }));
const { countHolder } = vi.hoisted(() => ({
  countHolder: { value: 0 as number | null, error: null as { message: string } | null },
}));

vi.mock("@/lib/supabase/secret", () => ({
  createSupabaseSecretClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ count: countHolder.value, error: countHolder.error }),
      }),
    }),
  }),
}));

vi.mock("@/modules/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/billing")>();
  return { ...actual, resolveEntitlements: resolveMock };
});

import { checkCanAddSourceConnection } from "./entitlement-guard";

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  countHolder.value = 0;
  countHolder.error = null;
  resolveMock.mockReset();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

function observeBlockLogged(): boolean {
  return warnSpy.mock.calls.some(
    (c: unknown[]) =>
      typeof c[0] === "string" && c[0].includes("[billing][observe]") && c[0].includes("WOULD block"),
  );
}

describe("checkCanAddSourceConnection (observe-only)", () => {
  it("allows and logs nothing when under the limit", async () => {
    resolveMock.mockResolvedValue(ok({ ...PLAN_ENTITLEMENTS.plan_operator })); // max 3
    countHolder.value = 2;

    const allowed = await checkCanAddSourceConnection({ tenantId: "t1", system: "github" });

    expect(allowed).toBe(true);
    expect(observeBlockLogged()).toBe(false);
  });

  it("allows but logs a would-block when at/over the limit (observe-only)", async () => {
    resolveMock.mockResolvedValue(ok({ ...PLAN_ENTITLEMENTS.plan_operator })); // max 3
    countHolder.value = 3; // 3 + 1 > 3

    const allowed = await checkCanAddSourceConnection({ tenantId: "t1", system: "teams" });

    expect(allowed).toBe(true); // observe-only never blocks
    expect(observeBlockLogged()).toBe(true);
  });

  it("allows with no would-block for an unlimited (null) limit", async () => {
    resolveMock.mockResolvedValue(ok({ ...PLAN_ENTITLEMENTS.plan_enterprise })); // null = unlimited
    countHolder.value = 9_999;

    const allowed = await checkCanAddSourceConnection({ tenantId: "t1", system: "email" });

    expect(allowed).toBe(true);
    expect(observeBlockLogged()).toBe(false);
  });

  it("fails open (allows + logs) when entitlement resolution errors", async () => {
    resolveMock.mockResolvedValue(err(new AppError("internal", "boom")));
    countHolder.value = 100;

    const allowed = await checkCanAddSourceConnection({ tenantId: "t1", system: "notion" });

    expect(allowed).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("fails open (allows + logs) when the count query errors", async () => {
    resolveMock.mockResolvedValue(ok({ ...PLAN_ENTITLEMENTS.plan_operator }));
    countHolder.error = { message: "db down" };

    const allowed = await checkCanAddSourceConnection({ tenantId: "t1", system: "obsidian" });

    expect(allowed).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });
});
