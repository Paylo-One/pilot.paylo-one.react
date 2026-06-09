/**
 * GET /api/oauth/google/start
 *
 * Begin the shared Google OAuth flow (Gmail + Calendar). Re-derives the trusted
 * tenant context, signs it into the OAuth `state` (reusing the generic signed-
 * state helpers), stores a matching nonce in a short-lived apex-shared cookie so
 * the neutral `app.` callback host can read it, then redirects to Google's
 * authorize endpoint. Governance: source-connection.md, integration-architecture.md.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { tenantBaseUrl, isDev } from "@/lib/config";
import {
  createSignedState,
  oauthCookieDomain,
  OAUTH_STATE_TTL_SECONDS,
} from "@/modules/source-connection/github";
import {
  buildGoogleAuthorizeUrl,
  isGoogleOAuthConfigured,
  GOOGLE_STATE_COOKIE,
} from "@/modules/source-connection/google";

export async function GET() {
  const ctx = await requireTenantContext();

  if (!isGoogleOAuthConfigured()) {
    return NextResponse.redirect(`${tenantBaseUrl(ctx.tenantSlug)}/sources?google=unconfigured`);
  }

  const { token, nonce } = createSignedState({
    tenantId: ctx.tenantId,
    tenantSlug: ctx.tenantSlug,
    userId: ctx.userId,
    role: ctx.role,
  });

  const cookieStore = await cookies();
  cookieStore.set(GOOGLE_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: !isDev(),
    sameSite: "lax",
    path: "/",
    domain: oauthCookieDomain(),
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });

  return NextResponse.redirect(buildGoogleAuthorizeUrl(token));
}
