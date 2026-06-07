/**
 * GET /api/oauth/github/callback
 *
 * GitHub redirects here (on the neutral `app.` host, so there is NO user
 * session). We recover the tenant context from the signed `state` (validated
 * against the cookie nonce), then use the SECRET client for every write —
 * always scoped by the explicit tenant_id. Steps: exchange code → store
 * credentials → upsert the github connection → fetch a real activity slice →
 * ingest it → redirect back to the tenant Sources page.
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
import { ingestProviderItems } from "@/modules/ingestion/server";
import {
  exchangeCodeForToken,
  fetchGithubSlice,
  verifySignedState,
  oauthCookieDomain,
  GITHUB_STATE_COOKIE,
} from "@/modules/source-connection/github";

function clearStateCookie(response: NextResponse): void {
  response.cookies.set(GITHUB_STATE_COOKIE, "", {
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
  const cookieNonce = cookieStore.get(GITHUB_STATE_COOKIE)?.value;

  const payload = verifySignedState(state, cookieNonce);

  // Without a valid state we cannot trust the tenant; bounce to the apex.
  if (!payload) {
    const response = NextResponse.redirect(`${apexBaseUrl()}/sign-in?error=oauth_state`);
    clearStateCookie(response);
    return response;
  }

  const sourcesUrl = `${tenantBaseUrl(payload.tenantSlug)}/sources`;

  // User declined consent on GitHub.
  if (oauthError || !code) {
    const response = NextResponse.redirect(`${sourcesUrl}?github=denied`);
    clearStateCookie(response);
    return response;
  }

  try {
    const token = await exchangeCodeForToken(code);
    const slice = await fetchGithubSlice(token.accessToken);

    const displayName = slice.username ? `GitHub (@${slice.username})` : "GitHub";
    const connectionId = await upsertProviderConnection(payload.tenantId, "github", {
      displayName,
      status: "connected",
    });

    await storeIntegrationCredentials(payload.tenantId, connectionId, {
      accessToken: token.accessToken,
      scope: token.scope,
    });

    const result = await ingestProviderItems(
      payload.tenantId,
      connectionId,
      "github",
      slice.items,
    );

    const ctx: TenantContext = {
      tenantId: payload.tenantId,
      tenantSlug: payload.tenantSlug,
      userId: payload.userId,
      role: payload.role as TenantRole,
    };
    await auditService.record(ctx, {
      action: "source_connection.github.connected",
      target: connectionId,
      metadata: { itemCount: result.itemCount, username: slice.username },
    });

    const response = NextResponse.redirect(
      `${sourcesUrl}?github=connected&count=${result.itemCount}`,
    );
    clearStateCookie(response);
    return response;
  } catch {
    const response = NextResponse.redirect(`${sourcesUrl}?github=error`);
    clearStateCookie(response);
    return response;
  }
}
