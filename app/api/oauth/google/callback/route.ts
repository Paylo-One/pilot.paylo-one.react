/**
 * GET /api/oauth/google/callback
 *
 * Google redirects here (neutral `app.` host, no user session). We recover the
 * tenant from the signed `state` (validated against the cookie nonce), exchange
 * the code, then — because one Google grant covers both Gmail and Calendar —
 * create/refresh BOTH the `email` and `calendar` connections, store the same
 * credentials for each, and discover selectable scope items (Gmail labels +
 * Google calendars). Nothing is ingested here: the operator must activate scope
 * items before any sync (ADR-024/025/026). Every write uses the SECRET client
 * scoped by the explicit tenant_id.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { tenantBaseUrl, apexBaseUrl, isDev } from "@/lib/config";
import type { TenantContext, TenantRole } from "@/modules/shared";
import { auditService } from "@/modules/audit";
import {
  upsertProviderConnection,
  storeIntegrationCredentials,
} from "@/modules/source-connection/server";
import { verifySignedState, oauthCookieDomain } from "@/modules/source-connection/github";
import {
  exchangeCodeForToken,
  fetchGmailLabels,
  fetchCalendars,
  GOOGLE_STATE_COOKIE,
} from "@/modules/source-connection/google";
import { upsertScopeItems } from "@/modules/source-connection/source-scope";

function clearStateCookie(response: NextResponse): void {
  response.cookies.set(GOOGLE_STATE_COOKIE, "", {
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
  const cookieNonce = cookieStore.get(GOOGLE_STATE_COOKIE)?.value;
  const payload = verifySignedState(state, cookieNonce);

  if (!payload) {
    const response = NextResponse.redirect(`${apexBaseUrl()}/sign-in?error=oauth_state`);
    clearStateCookie(response);
    return response;
  }

  const sourcesUrl = `${tenantBaseUrl(payload.tenantSlug)}/sources`;

  if (oauthError || !code) {
    const response = NextResponse.redirect(`${sourcesUrl}?google=denied`);
    clearStateCookie(response);
    return response;
  }

  try {
    const token = await exchangeCodeForToken(code);
    const creds = {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      scope: token.scope,
      expiresAt: token.expiresAt,
    };

    // One grant → both connections. Store creds for each (self-contained).
    const emailConnId = await upsertProviderConnection(payload.tenantId, "email", {
      displayName: "Gmail",
      status: "connected",
    });
    await storeIntegrationCredentials(payload.tenantId, emailConnId, creds);

    const calConnId = await upsertProviderConnection(payload.tenantId, "calendar", {
      displayName: "Google Calendar",
      status: "connected",
    });
    await storeIntegrationCredentials(payload.tenantId, calConnId, creds);

    // Discover selectable scope (available/inactive) — no ingestion.
    const [labels, calendars] = await Promise.all([
      fetchGmailLabels(token.accessToken),
      fetchCalendars(token.accessToken),
    ]);
    const labelsAdded = await upsertScopeItems(payload.tenantId, emailConnId, "email", labels);
    const calsAdded = await upsertScopeItems(payload.tenantId, calConnId, "calendar", calendars);

    const ctx: TenantContext = {
      tenantId: payload.tenantId,
      tenantSlug: payload.tenantSlug,
      userId: payload.userId,
      role: payload.role as TenantRole,
    };
    await auditService.record(ctx, {
      action: "source_connection.google.connected",
      target: emailConnId,
      metadata: { labels: labels.length, labelsAdded, calendars: calendars.length, calsAdded },
    });

    const response = NextResponse.redirect(
      `${sourcesUrl}?google=connected&labels=${labels.length}&calendars=${calendars.length}`,
    );
    clearStateCookie(response);
    return response;
  } catch {
    const response = NextResponse.redirect(`${sourcesUrl}?google=error`);
    clearStateCookie(response);
    return response;
  }
}
