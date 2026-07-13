/**
 * health.test.ts — component health checks behind the readiness probe.
 *
 * The Postgres probe must degrade gracefully: a query error OR a thrown client
 * (e.g. missing config) has to surface as an `error` component, never an
 * unhandled throw, so the route can answer 503 rather than 500.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { clientHolder } = vi.hoisted(() => ({
  clientHolder: {
    // `select(...).limit(...)` resolves to this; `throwOnCreate` simulates a
    // missing-config throw from the client factory.
    result: { error: null as { message: string } | null },
    throwOnCreate: null as Error | null,
  },
}));

vi.mock("@/lib/supabase/secret", () => ({
  createSupabaseSecretClient: () => {
    if (clientHolder.throwOnCreate) throw clientHolder.throwOnCreate;
    return {
      from: () => ({
        select: () => ({
          limit: () => Promise.resolve(clientHolder.result),
        }),
      }),
    };
  },
}));

import { checkDatabase, checkReadiness } from "./health";

beforeEach(() => {
  clientHolder.result = { error: null };
  clientHolder.throwOnCreate = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkDatabase", () => {
  it("reports ok with a latency when the query succeeds", async () => {
    const health = await checkDatabase();
    expect(health.status).toBe("ok");
    expect(health.error).toBeUndefined();
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports error (not a throw) when the query returns an error", async () => {
    clientHolder.result = { error: { message: "connection refused" } };
    const health = await checkDatabase();
    expect(health.status).toBe("error");
    expect(health.error).toBe("connection refused");
  });

  it("reports error (not a throw) when the client cannot be constructed", async () => {
    clientHolder.throwOnCreate = new Error("SUPABASE_SECRET_KEY is not set");
    const health = await checkDatabase();
    expect(health.status).toBe("error");
    expect(health.error).toBe("SUPABASE_SECRET_KEY is not set");
  });
});

describe("checkReadiness", () => {
  it("is ok when every critical component is ok", async () => {
    const report = await checkReadiness();
    expect(report.status).toBe("ok");
    expect(report.checks.database.status).toBe("ok");
  });

  it("is degraded when a critical component fails", async () => {
    clientHolder.result = { error: { message: "timeout" } };
    const report = await checkReadiness();
    expect(report.status).toBe("degraded");
    expect(report.checks.database.status).toBe("error");
  });
});
