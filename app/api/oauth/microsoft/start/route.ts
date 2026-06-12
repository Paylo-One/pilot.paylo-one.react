/**
 * GET /api/oauth/microsoft/start?product=mail|teams[&channels=1]
 *
 * Begin a Microsoft Entra OAuth flow for ONE connector — `mail` (MS 365 Mail:
 * Exchange mail + calendars) or `teams`. Each product consents its own
 * least-privilege scope set so the operator authorises and can revoke the
 * exact connector (ADR-027/037). Re-derives the trusted tenant context, signs
 * it into the OAuth `state`, stores the nonce + product in short-lived
 * apex-shared cookies so the neutral `app.` callback host can read them, then
 * redirects to the Entra authorize endpoint.
 *
 * `channels=1` additionally requests ChannelMessage.Read.All (Teams channel
 * messages) — only useful once a Microsoft 365 tenant admin has granted admin
 * consent; without it Entra shows the "Need admin approval" wall.
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
  buildMicrosoftAuthorizeUrl,
  isMicrosoftOAuthConfigured,
  MICROSOFT_STATE_COOKIE,
  MICROSOFT_PRODUCT_COOKIE,
  type MicrosoftProduct,
} from "@/modules/source-connection/microsoft";

export async function GET(request: Request) {
  const ctx = await requireTenantContext();
  const url = new URL(request.url);
  const product: MicrosoftProduct =
    url.searchParams.get("product") === "teams" ? "teams" : "mail";
  const includeChannels = url.searchParams.get("channels") === "1";

  if (!isMicrosoftOAuthConfigured()) {
    return NextResponse.redirect(
      `${tenantBaseUrl(ctx.tenantSlug)}/sources?microsoft=unconfigured`,
    );
  }

  const { token, nonce } = createSignedState({
    tenantId: ctx.tenantId,
    tenantSlug: ctx.tenantSlug,
    userId: ctx.userId,
    role: ctx.role,
  });

  const cookieOptions = {
    httpOnly: true,
    secure: !isDev(),
    sameSite: "lax" as const,
    path: "/",
    domain: oauthCookieDomain(),
    maxAge: OAUTH_STATE_TTL_SECONDS,
  };
  const cookieStore = await cookies();
  cookieStore.set(MICROSOFT_STATE_COOKIE, nonce, cookieOptions);
  cookieStore.set(MICROSOFT_PRODUCT_COOKIE, product, cookieOptions);

  return NextResponse.redirect(
    buildMicrosoftAuthorizeUrl(token, product, { includeChannels }),
  );
}
