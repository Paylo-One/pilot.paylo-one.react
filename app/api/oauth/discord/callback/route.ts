/**
 * GET /api/oauth/discord/callback
 *
 * Discord redirects here after bot install/authorisation. We store the OAuth
 * token, create the Discord source connection, discover visible server
 * channels, and leave ingestion disabled until the operator activates channels.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { tenantBaseUrl, appHostBaseUrl, isDev } from "@/lib/config";
import type { TenantContext, TenantRole } from "@/modules/shared";
import { auditService } from "@/modules/audit";
import { upsertProviderConnection } from "@/modules/source-connection/server";
import { verifySignedState, oauthCookieDomain } from "@/modules/source-connection/github";
import {
  DISCORD_STATE_COOKIE,
  exchangeDiscordCode,
  fetchDiscordGuildChannels,
  storeDiscordToken,
} from "@/modules/source-connection/discord";
import { upsertScopeItems } from "@/modules/source-connection/source-scope";

function clearStateCookie(response: NextResponse): void {
  response.cookies.set(DISCORD_STATE_COOKIE, "", {
    httpOnly: true,
    secure: !isDev(),
    sameSite: "lax",
    path: "/",
    domain: oauthCookieDomain(),
    maxAge: 0,
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? undefined;
  const state = url.searchParams.get("state") ?? undefined;
  const oauthError = url.searchParams.get("error");

  const cookieStore = await cookies();
  const payload = verifySignedState(state, cookieStore.get(DISCORD_STATE_COOKIE)?.value);
  if (!payload) {
    const response = NextResponse.redirect(`${appHostBaseUrl()}/sign-in?error=oauth_state`);
    clearStateCookie(response);
    return response;
  }

  const sourcesUrl = `${tenantBaseUrl(payload.tenantSlug)}/sources`;
  if (oauthError || !code) {
    const response = NextResponse.redirect(`${sourcesUrl}?discord=denied`);
    clearStateCookie(response);
    return response;
  }

  try {
    const token = await exchangeDiscordCode(code);
    const connectionId = await upsertProviderConnection(payload.tenantId, "discord", {
      displayName: "Discord",
      status: "connected",
      permissionsGranted: {
        scopes: token.scope?.split(" ").filter(Boolean) ?? [],
        botPermissions: ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"],
      },
    });
    await storeDiscordToken(payload.tenantId, connectionId, token);

    const channels = await fetchDiscordGuildChannels(token.accessToken);
    await upsertScopeItems(payload.tenantId, connectionId, "discord", channels);

    const guildIds = new Set(
      channels
        .map((c) => c.metadata?.guildId)
        .filter((v): v is string => typeof v === "string"),
    );
    const ctx: TenantContext = {
      tenantId: payload.tenantId,
      tenantSlug: payload.tenantSlug,
      userId: payload.userId,
      role: payload.role as TenantRole,
    };
    await auditService.record(ctx, {
      action: "source_connection.discord.connected",
      target: connectionId,
      metadata: { guilds: guildIds.size, channels: channels.length },
    });

    const response = NextResponse.redirect(
      `${sourcesUrl}?discord=connected&servers=${guildIds.size}&channels=${channels.length}`,
    );
    clearStateCookie(response);
    return response;
  } catch {
    const response = NextResponse.redirect(`${sourcesUrl}?discord=error`);
    clearStateCookie(response);
    return response;
  }
}
