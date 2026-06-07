import "server-only";

/**
 * modules/source-connection/github.ts
 *
 * GitHub OAuth (web application flow) helpers. Server-only: reads the OAuth app
 * credentials and the secret signing key, talks to GitHub over HTTPS, and signs
 * the OAuth `state` so the (neutral-host) callback can recover the tenant context
 * without a user session.
 *
 * Governance: integration-architecture.md (GitHub: read-only, least privilege),
 * services/source-connection.md (credentials server-only, record granted scopes).
 */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { activeApex, isDev, devApex, devPort, appApex, supabaseSecretKey } from "@/lib/config";
import type { ProviderRawItem } from "@/modules/ingestion";

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const API_BASE = "https://api.github.com";

/** Least-privilege, read-only scope (no repo write, no send). */
const GITHUB_SCOPE = "read:user";

/** Lifetime of the OAuth state nonce (seconds). */
export const OAUTH_STATE_TTL_SECONDS = 600;

/** Name of the short-lived OAuth state cookie. */
export const GITHUB_STATE_COOKIE = "paylo_gh_oauth";

function clientId(): string | undefined {
  return process.env.GITHUB_OAUTH_CLIENT_ID?.trim() || undefined;
}

function clientSecret(): string | undefined {
  return process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim() || undefined;
}

/** True when both OAuth app credentials are configured. */
export function isGithubOAuthConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

/**
 * Cookie domain so the state cookie set on a tenant subdomain is also readable
 * on the neutral `app.` callback host (both share the registrable apex).
 */
export function oauthCookieDomain(): string {
  return `.${activeApex()}`;
}

/** The fixed OAuth callback URL on the reserved `app.` host. */
export function githubCallbackUrl(): string {
  return isDev()
    ? `http://app.${devApex()}:${devPort()}/api/oauth/github/callback`
    : `https://app.${appApex()}/api/oauth/github/callback`;
}

// --- Signed state -----------------------------------------------------------

/** Tenant/session context carried through the OAuth round-trip. */
export interface OAuthStatePayload {
  /** Random nonce; also mirrored in the cookie for CSRF protection. */
  readonly nonce: string;
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly userId: string;
  readonly role: string;
  /** Expiry (epoch seconds). */
  readonly exp: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(value: string): string {
  return createHmac("sha256", supabaseSecretKey()).update(value).digest("base64url");
}

/** Build a fresh signed state token + the nonce to store in the cookie. */
export function createSignedState(input: {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  role: string;
}): { token: string; nonce: string } {
  const nonce = randomBytes(16).toString("base64url");
  const payload: OAuthStatePayload = {
    nonce,
    tenantId: input.tenantId,
    tenantSlug: input.tenantSlug,
    userId: input.userId,
    role: input.role,
    exp: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS,
  };
  const body = base64url(JSON.stringify(payload));
  const token = `${body}.${sign(body)}`;
  return { token, nonce };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a state token against the cookie nonce. Returns the payload when the
 * signature is valid, the token has not expired, and the nonce matches.
 */
export function verifySignedState(
  token: string | undefined,
  cookieNonce: string | undefined,
): OAuthStatePayload | null {
  if (!token || !cookieNonce) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  if (!safeEqual(signature, sign(body))) return null;

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload?.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  if (!payload.nonce || !safeEqual(payload.nonce, cookieNonce)) return null;
  if (!payload.tenantId || !payload.tenantSlug || !payload.userId) return null;
  return payload;
}

// --- OAuth flow -------------------------------------------------------------

/** Build the GitHub authorize URL for a given signed state token. */
export function buildGithubAuthorizeUrl(stateToken: string): string {
  const id = clientId();
  if (!id) throw new Error("github_oauth_not_configured");
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: githubCallbackUrl(),
    scope: GITHUB_SCOPE,
    state: stateToken,
    allow_signup: "false",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface GithubToken {
  accessToken: string;
  scope: string | null;
  tokenType: string | null;
}

/** Exchange an authorisation code for an access token. */
export async function exchangeCodeForToken(code: string): Promise<GithubToken> {
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) throw new Error("github_oauth_not_configured");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: id,
      client_secret: secret,
      code,
      redirect_uri: githubCallbackUrl(),
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`github_token_exchange_failed_${response.status}`);
  }
  const data = (await response.json()) as {
    access_token?: string;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || "github_token_missing");
  }
  return {
    accessToken: data.access_token,
    scope: data.scope ?? null,
    tokenType: data.token_type ?? null,
  };
}

async function githubGet<T>(token: string, path: string): Promise<T | null> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "paylo-one-management-os",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

interface GithubUser {
  login: string;
  name: string | null;
}

interface GithubEvent {
  id: string;
  type: string | null;
  created_at: string | null;
  repo?: { name?: string } | null;
  payload?: { action?: string } | null;
}

interface GithubRepo {
  full_name: string;
  description: string | null;
  html_url: string;
  updated_at: string | null;
}

/**
 * Fetch a small slice of real, read-only GitHub activity for the authenticated
 * user: recent public events, falling back to recently updated repositories.
 * Bounded to keep cost/exposure low (integration-architecture.md).
 */
export async function fetchGithubSlice(token: string): Promise<{
  username: string | null;
  items: ProviderRawItem[];
}> {
  const user = await githubGet<GithubUser>(token, "/user");
  const username = user?.login ?? null;
  const items: ProviderRawItem[] = [];

  if (username) {
    const events = await githubGet<GithubEvent[]>(
      token,
      `/users/${encodeURIComponent(username)}/events/public?per_page=15`,
    );
    for (const event of events ?? []) {
      const repo = event.repo?.name ?? "github";
      const action = event.payload?.action ? ` (${event.payload.action})` : "";
      const type = event.type ?? "Activity";
      items.push({
        externalId: `event:${event.id}`,
        title: `${type}${action} \u00b7 ${repo}`,
        body: `${type}${action} on ${repo}.`,
        author: username,
        occurredAt: event.created_at ?? null,
        kind: "event",
        raw: event as unknown as Record<string, unknown>,
      });
    }
  }

  if (items.length === 0) {
    const repos = await githubGet<GithubRepo[]>(
      token,
      "/user/repos?sort=updated&per_page=10",
    );
    for (const repo of repos ?? []) {
      items.push({
        externalId: `repo:${repo.full_name}`,
        title: repo.full_name,
        body: repo.description?.trim() || `${repo.full_name} \u2014 ${repo.html_url}`,
        author: username,
        occurredAt: repo.updated_at ?? null,
        kind: "repository",
        raw: repo as unknown as Record<string, unknown>,
      });
    }
  }

  return { username, items };
}
