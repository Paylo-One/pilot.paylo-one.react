/**
 * proxy.ts
 *
 * Host-based tenant resolution + auth gate at the edge. In Next 15/16 this is
 * the "proxy" (successor to middleware.ts). Governance: technical-design.md
 * §"Tenant Resolution Strategy" and multi-tenancy-design.md §"Tenant Resolution
 * From Host".
 *
 * Responsibilities (scaffold shows the shape; DB + session checks are stubbed):
 *   1. Validate the Host against the allowlisted apex (anti host-header-spoofing).
 *      We resolve ONLY from the host the platform served us — never a
 *      client-supplied X-Forwarded-Host / Forwarded.
 *   2. Apex / www / reserved -> marketing or auth (not the tenant app).
 *   3. Unknown / invalid host -> fail closed (holding/404).
 *   4. Valid tenant subdomain -> attach the slug to a request header and let the
 *      app re-derive the FULL tenant context (membership, role) server-side.
 *
 * IMPORTANT: the slug attached here is a routing hint only. Authorisation is
 * re-derived server-side and enforced by RLS; the client value is never trusted.
 */

import { NextResponse, type NextRequest } from "next/server";
import { activeApex } from "@/lib/config";
import { resolveHost } from "@/lib/tenant/host";
import { refreshSupabaseSession } from "@/lib/supabase/proxy";

/** Header used to pass the (untrusted) routing slug to the app layer. */
export const TENANT_SLUG_HEADER = "x-paylo-tenant-slug";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // Use the platform-provided host only. Do NOT read X-Forwarded-Host here.
  const host = request.headers.get("host");
  const decision = resolveHost(host, activeApex());

  // Fail closed: an unrecognised host never reaches the app (no session work).
  if (decision.kind === "invalid") {
    return new NextResponse("Not found", { status: 404 });
  }

  // For a valid tenant subdomain, attach the (untrusted) routing slug so server
  // loaders can re-derive { userId, tenantId, role } and verify tenant_users
  // membership (session<->tenant binding). RLS is the database backstop.
  const requestHeaders = new Headers(request.headers);
  if (decision.kind === "tenant") {
    requestHeaders.set(TENANT_SLUG_HEADER, decision.slug);
  } else {
    requestHeaders.delete(TENANT_SLUG_HEADER); // strip any client-supplied value
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // Refresh the Supabase auth session and persist rotated cookies on the
  // response (getClaims validates the JWT signature).
  await refreshSupabaseSession(request, response);

  return response;
}

/**
 * Match all routes except Next internals and static assets. Wire this file as
 * `middleware.ts` (or the framework's proxy entrypoint) when activating.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
