/**
 * /api/health — liveness probe (technical-design.md §"API Route Strategy").
 *
 * Answers "is the process up and serving?" with no external I/O, so it is safe
 * for a load balancer to poll frequently. Dependency reachability (database,
 * gateways) is a separate concern — see the readiness probe at
 * `/api/health/ready`, which returns 503 when a critical dependency is down.
 */

import { NextResponse } from "next/server";

// Never cache/prerender: a health probe must reflect the live process.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    probe: "liveness",
    service: "paylo-one-app",
    timestamp: new Date().toISOString(),
  });
}
