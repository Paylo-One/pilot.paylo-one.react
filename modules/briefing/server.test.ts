/**
 * server.test.ts — observe-only maxBriefingsPerDay enforcement.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ok, err, AppError } from "@/modules/shared";
import { PLAN_ENTITLEMENTS } from "@/modules/billing/plans";

const { resolveMock } = vi.hoisted(() => ({ resolveMock: vi.fn() }));
const { countHolder } = vi.hoisted(() => ({
  countHolder: { value: 0 as number | null, error: null as { message: string } | null },
}));
const { profileHolder, boundsHolder } = vi.hoisted(() => ({
  profileHolder: {
    timezone: "Europe/Amsterdam" as string | null,
    error: null as { message: string } | null,
  },
  boundsHolder: { start: "", end: "" },
}));

vi.mock("@/lib/supabase/secret", () => ({
  createSupabaseSecretClient: () => ({
    from: (table: string) =>
      table === "user_profiles"
        ? {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: profileHolder.timezone ? { timezone: profileHolder.timezone } : null,
                    error: profileHolder.error,
                  }),
              }),
            }),
          }
        : {
            select: () => ({
              eq: () => ({
                gte: (_column: string, start: string) => {
                  boundsHolder.start = start;
                  return {
                    lt: (_endColumn: string, end: string) => {
                      boundsHolder.end = end;
                      return Promise.resolve({
                        count: countHolder.value,
                        error: countHolder.error,
                      });
                    },
                  };
                },
              }),
            }),
          },
  }),
}));

vi.mock("@/modules/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/billing")>();
  return { ...actual, resolveEntitlements: resolveMock };
});

import { checkBriefingLimit } from "./server";

let warnSpy: ReturnType<typeof vi.spyOn>;
const ctx = {
  tenantId: "t1",
  tenantSlug: "test",
  userId: "u1",
  role: "owner" as const,
};

beforeEach(() => {
  countHolder.value = 0;
  countHolder.error = null;
  profileHolder.timezone = "Europe/Amsterdam";
  profileHolder.error = null;
  boundsHolder.start = "";
  boundsHolder.end = "";
  resolveMock.mockReset();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  warnSpy.mockRestore();
});

function observeBlockLogged(): boolean {
  return warnSpy.mock.calls.some(
    (c: unknown[]) =>
      typeof c[0] === "string" && c[0].includes("[billing][observe]") && c[0].includes("WOULD block"),
  );
}

describe("checkBriefingLimit (observe-only)", () => {
  it("allows and logs nothing when under the limit", async () => {
    resolveMock.mockResolvedValue(ok({ ...PLAN_ENTITLEMENTS.plan_operator })); // max 1 per day
    countHolder.value = 0;

    const allowed = await checkBriefingLimit(ctx);

    expect(allowed).toBe(true);
    expect(observeBlockLogged()).toBe(false);
  });

  it("allows but logs a would-block when at/over the limit (observe-only)", async () => {
    resolveMock.mockResolvedValue(ok({ ...PLAN_ENTITLEMENTS.plan_operator })); // max 1 per day
    countHolder.value = 1; // 1 + 1 > 1

    const allowed = await checkBriefingLimit(ctx);

    expect(allowed).toBe(true); // observe-only never blocks
    expect(observeBlockLogged()).toBe(true);
  });

  it("allows with no would-block for an unlimited (null) limit", async () => {
    resolveMock.mockResolvedValue(ok({ ...PLAN_ENTITLEMENTS.plan_enterprise })); // null = unlimited
    countHolder.value = 9_999;

    const allowed = await checkBriefingLimit(ctx);

    expect(allowed).toBe(true);
    expect(observeBlockLogged()).toBe(false);
  });

  it("fails open (allows + logs) when entitlement resolution errors", async () => {
    resolveMock.mockResolvedValue(err(new AppError("internal", "boom")));
    countHolder.value = 100;

    const allowed = await checkBriefingLimit(ctx);

    expect(allowed).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("fails open (allows + logs) when the count query errors", async () => {
    resolveMock.mockResolvedValue(ok({ ...PLAN_ENTITLEMENTS.plan_operator }));
    countHolder.error = { message: "db down" };

    const allowed = await checkBriefingLimit(ctx);

    expect(allowed).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("counts within the operator's local day instead of the UTC day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T22:30:00Z"));
    resolveMock.mockResolvedValue(ok({ ...PLAN_ENTITLEMENTS.plan_operator }));

    await checkBriefingLimit(ctx);

    expect(boundsHolder.start).toBe("2026-07-17T22:00:00.000Z");
    expect(boundsHolder.end).toBe("2026-07-18T22:00:00.000Z");
  });

  it("falls back to UTC and warns when the profile timezone cannot be read", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T22:30:00Z"));
    resolveMock.mockResolvedValue(ok({ ...PLAN_ENTITLEMENTS.plan_operator }));
    profileHolder.timezone = null;
    profileHolder.error = { message: "db down" };

    await checkBriefingLimit(ctx);

    expect(boundsHolder.start).toBe("2026-07-17T00:00:00.000Z");
    expect(warnSpy).toHaveBeenCalled();
  });
});
