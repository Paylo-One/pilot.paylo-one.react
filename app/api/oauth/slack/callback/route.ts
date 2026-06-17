/**
 * GET /api/oauth/slack/callback
 *
 * Slack redirects here after workspace install. We store the bot token
 * server-side, create the Slack source connection, discover public channels as
 * inactive scope items, and return the operator to Sources for channel choice.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { tenantBaseUrl, appHostBaseUrl, isDev } from "@/lib/config";
import type { TenantContext, TenantRole } from "@/modules/shared";
import { auditService } from "@/modules/audit";
import {
  upsertProviderConnection,
} from "@/modules/source-connection/server";
import { verifySignedState, oauthCookieDomain } from "@/modules/source-connection/github";
import {
  exchangeSlackCode,
  fetchSlackPublicChannels,
  storeSlackToken,
  SLACK_STATE_COOKIE,
} from "@/modules/source-connection/slack";
import { upsertScopeItems } from "@/modules/source-connection/source-scope";

function clearStateCookie(response: NextResponse): void {
  response.cookies.set(SLACK_STATE_COOKIE, "", {
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
  const payload = verifySignedState(state, cookieStore.get(SLACK_STATE_COOKIE)?.value);
  if (!payload) {
    const response = NextResponse.redirect(`${appHostBaseUrl()}/sign-in?error=oauth_state`);
    clearStateCookie(response);
    return response;
  }

  const sourcesUrl = `${tenantBaseUrl(payload.tenantSlug)}/sources`;
  if (oauthError || !code) {
    const response = NextResponse.redirect(`${sourcesUrl}?slack=denied`);
    clearStateCookie(response);
    return response;
  }

  try {
    const token = await exchangeSlackCode(code);
    const displayName = token.teamName ? `Slack (${token.teamName})` : "Slack";
    const connectionId = await upsertProviderConnection(payload.tenantId, "slack", {
      displayName,
      status: "connected",
      providerWorkspaceId: token.teamId,
      providerWorkspaceName: token.teamName,
      permissionsGranted: { scopes: token.scope?.split(",").filter(Boolean) ?? [] },
    });
    await storeSlackToken(payload.tenantId, connectionId, token);

    const channels = await fetchSlackPublicChannels(token.accessToken);
    await upsertScopeItems(payload.tenantId, connectionId, "slack", channels);

    const ctx: TenantContext = {
      tenantId: payload.tenantId,
      tenantSlug: payload.tenantSlug,
      userId: payload.userId,
      role: payload.role as TenantRole,
    };
    await auditService.record(ctx, {
      action: "source_connection.slack.connected",
      target: connectionId,
      metadata: { teamId: token.teamId, teamName: token.teamName, channels: channels.length },
    });

    const response = NextResponse.redirect(`${sourcesUrl}?slack=connected&channels=${channels.length}`);
    clearStateCookie(response);
    return response;
  } catch {
    const response = NextResponse.redirect(`${sourcesUrl}?slack=error`);
    clearStateCookie(response);
    return response;
  }
}
