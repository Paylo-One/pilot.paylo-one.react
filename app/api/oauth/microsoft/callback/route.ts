/**
 * GET /api/oauth/microsoft/callback
 *
 * Entra redirects here (neutral `app.` host, no user session). We recover the
 * tenant from the signed `state` (validated against the cookie nonce) and the
 * connector from the product cookie, exchange the code, create/refresh the
 * matching connection (`ms365_mail` or `teams`), store credentials, and
 * discover selectable scope items (mail folders + calendars, or chats +
 * channels). Nothing is ingested here: the operator must activate scope items
 * before any sync (ADR-024/025/026). Every write uses the SECRET client scoped
 * by the explicit tenant_id.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { tenantBaseUrl, appHostBaseUrl, isDev } from "@/lib/config";
import type { TenantContext, TenantRole } from "@/modules/shared";
import { auditService } from "@/modules/audit";
import {
  upsertProviderConnection,
  storeIntegrationCredentials,
} from "@/modules/source-connection/server";
import { verifySignedState, oauthCookieDomain } from "@/modules/source-connection/github";
import {
  exchangeMicrosoftCode,
  fetchMailFolders,
  fetchMs365Calendars,
  fetchTeamsChats,
  fetchTeamsChannels,
  MICROSOFT_STATE_COOKIE,
  MICROSOFT_PRODUCT_COOKIE,
  type MicrosoftProduct,
} from "@/modules/source-connection/microsoft";
import { upsertScopeItems } from "@/modules/source-connection/source-scope";

function clearStateCookies(response: NextResponse): void {
  for (const name of [MICROSOFT_STATE_COOKIE, MICROSOFT_PRODUCT_COOKIE]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: !isDev(),
      sameSite: "lax",
      path: "/",
      domain: oauthCookieDomain(),
      maxAge: 0,
    });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? undefined;
  const state = url.searchParams.get("state") ?? undefined;
  const oauthError = url.searchParams.get("error");

  const cookieStore = await cookies();
  const cookieNonce = cookieStore.get(MICROSOFT_STATE_COOKIE)?.value;
  const product: MicrosoftProduct =
    cookieStore.get(MICROSOFT_PRODUCT_COOKIE)?.value === "teams" ? "teams" : "mail";
  const payload = verifySignedState(state, cookieNonce);

  if (!payload) {
    const response = NextResponse.redirect(`${appHostBaseUrl()}/sign-in?error=oauth_state`);
    clearStateCookies(response);
    return response;
  }

  const sourcesUrl = `${tenantBaseUrl(payload.tenantSlug)}/sources`;

  if (oauthError || !code) {
    const response = NextResponse.redirect(`${sourcesUrl}?microsoft=denied`);
    clearStateCookies(response);
    return response;
  }

  try {
    const token = await exchangeMicrosoftCode(code);
    const creds = {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      scope: token.scope,
      expiresAt: token.expiresAt,
    };

    const system = product === "teams" ? "teams" : "ms365_mail";
    const connectionId = await upsertProviderConnection(payload.tenantId, system, {
      displayName: product === "teams" ? "Microsoft Teams" : "Microsoft 365 Mail",
      status: "connected",
    });
    await storeIntegrationCredentials(payload.tenantId, connectionId, creds);

    // Discover selectable scope (available/inactive) — no ingestion. Channel
    // discovery is best-effort: ReadBasic listing is user-consentable, and a
    // Graph denial simply yields no channel rows (chats remain).
    let discovered: { a: number; b: number };
    if (product === "teams") {
      const chats = await fetchTeamsChats(token.accessToken);
      const channels = await fetchTeamsChannels(token.accessToken).catch(() => []);
      await upsertScopeItems(payload.tenantId, connectionId, "teams", [
        ...chats,
        ...channels,
      ]);
      discovered = { a: chats.length, b: channels.length };
    } else {
      const [folders, calendars] = await Promise.all([
        fetchMailFolders(token.accessToken),
        fetchMs365Calendars(token.accessToken),
      ]);
      await upsertScopeItems(payload.tenantId, connectionId, "ms365_mail", [
        ...folders,
        ...calendars,
      ]);
      discovered = { a: folders.length, b: calendars.length };
    }

    const ctx: TenantContext = {
      tenantId: payload.tenantId,
      tenantSlug: payload.tenantSlug,
      userId: payload.userId,
      role: payload.role as TenantRole,
    };
    await auditService.record(ctx, {
      action: `source_connection.${system}.connected`,
      target: connectionId,
      metadata:
        product === "teams"
          ? { chats: discovered.a, channels: discovered.b }
          : { folders: discovered.a, calendars: discovered.b },
    });

    const response = NextResponse.redirect(
      product === "teams"
        ? `${sourcesUrl}?microsoft=connected&chats=${discovered.a}&channels=${discovered.b}`
        : `${sourcesUrl}?microsoft=connected&folders=${discovered.a}&calendars=${discovered.b}`,
    );
    clearStateCookies(response);
    return response;
  } catch {
    const response = NextResponse.redirect(`${sourcesUrl}?microsoft=error`);
    clearStateCookies(response);
    return response;
  }
}
