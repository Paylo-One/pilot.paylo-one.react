import "server-only";

/**
 * lib/health.ts
 *
 * Component health checks behind the operational probes (technical-design.md
 * §"API Route Strategy"). Two probe shapes, per the standard liveness/readiness
 * split:
 *
 *   - Liveness (`/api/health`): "is the process up?" — no I/O, always fast.
 *   - Readiness (`/api/health/ready`): "can we serve traffic?" — rolls up the
 *     component checks below. A load balancer / uptime monitor uses this to
 *     decide whether to route to (or page on) this instance.
 *
 * The database round-trip uses the secret client so the probe does NOT depend
 * on a user session; it is a pure infrastructure reachability signal. It never
 * reads tenant content — only that Postgres answers.
 */

import { createSupabaseSecretClient } from "@/lib/supabase/secret";

export type ComponentStatus = "ok" | "error";

export interface ComponentHealth {
  readonly status: ComponentStatus;
  /** Round-trip time for the check, in milliseconds. */
  readonly latencyMs: number;
  /** Present only when `status === "error"`. Safe, non-sensitive summary. */
  readonly error?: string;
}

export interface ReadinessChecks {
  readonly database: ComponentHealth;
}

export interface ReadinessReport {
  /** `ok` when every critical component is `ok`; otherwise `degraded`. */
  readonly status: "ok" | "degraded";
  readonly checks: ReadinessChecks;
}

function elapsedMs(startMs: number): number {
  return Math.max(0, Math.round(Date.now() - startMs));
}

/**
 * Cheap Postgres reachability probe: a single-row read of a stable, always-present
 * table via the RLS-bypassing secret client. Confirms the connection, credentials,
 * and schema are live without returning any tenant content. Never throws — a
 * missing config value or a dropped connection is reported as an `error` component
 * so the route can answer 503 instead of 500.
 */
export async function checkDatabase(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    const supabase = createSupabaseSecretClient();
    const { error } = await supabase.from("tenants").select("id").limit(1);
    if (error) {
      return { status: "error", latencyMs: elapsedMs(start), error: error.message };
    }
    return { status: "ok", latencyMs: elapsedMs(start) };
  } catch (cause) {
    return {
      status: "error",
      latencyMs: elapsedMs(start),
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * Roll up all critical component checks into a single readiness verdict. Runs
 * the checks concurrently so the probe latency is the slowest check, not their
 * sum.
 */
export async function checkReadiness(): Promise<ReadinessReport> {
  const [database] = await Promise.all([checkDatabase()]);
  const checks: ReadinessChecks = { database };
  const allOk = Object.values(checks).every((c) => c.status === "ok");
  return { status: allOk ? "ok" : "degraded", checks };
}
