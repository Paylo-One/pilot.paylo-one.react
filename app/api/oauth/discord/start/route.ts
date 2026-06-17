/**
 * GET /api/oauth/discord/start
 *
 * Begin Discord OAuth2 with bot install. The bot gets server read permissions;
 * the user token lets us discover the operator's guilds and intersect them with
 * channels visible to the bot.
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
  buildDiscordAuthorizeUrl,
  isDiscordOAuthConfigured,
  DISCORD_STATE_COOKIE,
} from "@/modules/source-connection/discord";

export async function GET() {
  const ctx = await requireTenantContext();

  if (!isDiscordOAuthConfigured()) {
    return NextResponse.redirect(`${tenantBaseUrl(ctx.tenantSlug)}/sources?discord=unconfigured`);
  }

  const { token, nonce } = createSignedState({
    tenantId: ctx.tenantId,
    tenantSlug: ctx.tenantSlug,
    userId: ctx.userId,
    role: ctx.role,
  });

  const cookieStore = await cookies();
  cookieStore.set(DISCORD_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: !isDev(),
    sameSite: "lax",
    path: "/",
    domain: oauthCookieDomain(),
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });

  return NextResponse.redirect(buildDiscordAuthorizeUrl(token));
}
