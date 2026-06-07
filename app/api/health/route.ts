/**
 * /api/health — operational health probe (technical-design.md §"API Route
 * Strategy"). Returns a static OK; real checks (DB, gateways) are added later.
 */

import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "paylo-one-app",
    scaffold: true,
    timestamp: new Date().toISOString(),
  });
}
