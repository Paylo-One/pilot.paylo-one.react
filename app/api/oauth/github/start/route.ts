/**
 * GET /api/oauth/github/start
 *
 * Begin the GitHub OAuth flow. Re-derives the trusted tenant context, signs it
 * into the OAuth `state`, stores a matching nonce in a short-lived cookie shared
 * across the apex (so the neutral `app.` callback host can read it), then
 * redirects to GitHub's authorize endpoint. Governance: source-connection.md.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { tenantBaseUrl, isDev } from "@/lib/config";
import {
  buildGithubAuthorizeUrl,
  createSignedState,
  isGithubOAuthConfigured,
  oauthCookieDomain,
  GITHUB_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
} from "@/modules/source-connection/github";

export async function GET() {
  const ctx = await requireTenantContext();

  if (!isGithubOAuthConfigured()) {
    return NextResponse.redirect(`${tenantBaseUrl(ctx.tenantSlug)}/sources?github=unconfigured`);
  }

  const { token, nonce } = createSignedState({
    tenantId: ctx.tenantId,
    tenantSlug: ctx.tenantSlug,
    userId: ctx.userId,
    role: ctx.role,
  });

  const cookieStore = await cookies();
  cookieStore.set(GITHUB_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: !isDev(),
    sameSite: "lax",
    path: "/",
    domain: oauthCookieDomain(),
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });

  return NextResponse.redirect(buildGithubAuthorizeUrl(token));
}
