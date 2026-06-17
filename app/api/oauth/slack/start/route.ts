/**
 * GET /api/oauth/slack/start
 *
 * Begin Slack OAuth for a workspace install. The callback runs on the neutral
 * app host, so tenant context is carried through the signed state token.
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
  buildSlackAuthorizeUrl,
  isSlackOAuthConfigured,
  SLACK_STATE_COOKIE,
} from "@/modules/source-connection/slack";

export async function GET() {
  const ctx = await requireTenantContext();

  if (!isSlackOAuthConfigured()) {
    return NextResponse.redirect(`${tenantBaseUrl(ctx.tenantSlug)}/sources?slack=unconfigured`);
  }

  const { token, nonce } = createSignedState({
    tenantId: ctx.tenantId,
    tenantSlug: ctx.tenantSlug,
    userId: ctx.userId,
    role: ctx.role,
  });

  const cookieStore = await cookies();
  cookieStore.set(SLACK_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: !isDev(),
    sameSite: "lax",
    path: "/",
    domain: oauthCookieDomain(),
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });

  return NextResponse.redirect(buildSlackAuthorizeUrl(token));
}
