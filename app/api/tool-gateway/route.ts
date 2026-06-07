/**
 * /api/tool-gateway — INTERNAL boundary for the Paylo Tool Gateway.
 *
 * Governance: architecture/mcp-tool-architecture.md §5 (the Gateway ships as
 * modules behind one `/api/tool-gateway` boundary), §14 (MCP servers are reached
 * over a private, authenticated path — never public or tenant-facing);
 * services/tool-gateway-service.md "MVP implementation".
 *
 * IMPORTANT: This endpoint is server-side / agent-only. It is NEVER
 * tenant-facing or browser-facing — the browser and tenants must not be able to
 * reach the Tool Gateway, MCP endpoints, or tool credentials (§4, §9). Agents
 * and workflows invoke the Gateway in-process via `toolGateway.invoke`
 * (`@/modules/tool-gateway`); this HTTP surface exists only as the future
 * extraction seam for an internal service-to-service caller behind private,
 * authenticated networking.
 *
 * Scaffold: not implemented. Returns 501 so the unbuilt state is explicit.
 */

import { NextResponse } from "next/server";

/** Standard 501 response for every method on this internal-only route. */
function notImplemented(): NextResponse {
  return NextResponse.json(
    {
      error: "not_implemented",
      message:
        "Tool Gateway HTTP boundary is a scaffold. It is internal/agent-only " +
        "and never tenant- or browser-facing; agents call toolGateway.invoke in-process.",
      scaffold: true,
    },
    { status: 501 },
  );
}

export function GET() {
  return notImplemented();
}

export function POST() {
  return notImplemented();
}
