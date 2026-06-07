/**
 * /api/model-gateway — the internal boundary of the Paylo Model Gateway
 * (architecture/model-inference-architecture.md §5, §43; services/
 * model-gateway-service.md "MVP implementation").
 *
 * SECURITY BOUNDARY (security-and-privacy.md §"Model Gateway & Inference
 * Security"):
 *  - Provider API keys and the (future) vLLM endpoint are SERVER-SIDE ONLY
 *    (env/Vault) — never sent to the browser, never in tenant-readable tables,
 *    never logged.
 *  - The browser/tenant NEVER reaches a model provider or vLLM directly: the
 *    browser calls the app; the app/agents call the Gateway module
 *    (`@/modules/model-gateway`); only the Gateway reaches providers/vLLM via
 *    server-side adapters.
 *  - For the MVP, inference is driven in-process by agents/workflows through the
 *    `modelGateway` service, not over HTTP. This endpoint exists to mark the
 *    `/api/model-gateway` boundary and is intentionally NOT a public inference
 *    API.
 *
 * Scaffold note: returns 501 Not Implemented. No provider/vLLM call is wired.
 */

import { NextResponse } from "next/server";

/** Shared 501 response for every method on this not-yet-built boundary. */
function notImplemented() {
  return NextResponse.json(
    {
      status: "not_implemented",
      service: "model-gateway",
      scaffold: true,
      message:
        "Model Gateway boundary is not implemented. Provider/vLLM access is server-side only; the browser and tenants never reach a provider or vLLM directly.",
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
