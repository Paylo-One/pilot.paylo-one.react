/**
 * /api/health/ready — readiness probe (technical-design.md §"API Route
 * Strategy").
 *
 * Answers "can this instance actually serve traffic?" by rolling up the
 * component checks in `lib/health.ts` (currently: Postgres reachability). Returns
 * 200 when every critical dependency is healthy and 503 when any is down, so a
 * load balancer / uptime monitor can stop routing to (or page on) a degraded
 * instance instead of trusting a process that is up but cannot reach its data.
 */

import { NextResponse } from "next/server";
import { checkReadiness } from "@/lib/health";

// Never cache/prerender: readiness must reflect live dependency state.
export const dynamic = "force-dynamic";

export async function GET() {
  const report = await checkReadiness();
  return NextResponse.json(
    {
      status: report.status,
      probe: "readiness",
      service: "paylo-one-app",
      checks: report.checks,
      timestamp: new Date().toISOString(),
    },
    { status: report.status === "ok" ? 200 : 503 },
  );
}
