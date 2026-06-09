import "server-only";

/**
 * modules/source-connection/google.ts
 *
 * Shared Google OAuth client for the Google family — **Gmail** + **Calendar**.
 * One OAuth grant (read-only scopes, offline access for a refresh token) lights
 * up both source connections. Discovery lists Gmail labels + calendars as
 * selectable scope items; sync pulls **only** from active items, honouring the
 * principle that the operator scopes what is ingested.
 *
 * Server-only: reads OAuth app credentials + the signing key, talks to Google
 * over HTTPS, refreshes expiring access tokens. Reuses the signed-state helpers
 * from ./github (generic tenant-context CSRF state; not GitHub-specific logic).
 *
 * Governance: integration-architecture.md (Email/Calendar: read-only, least
 * privilege), source-integration-strategy.md §8/§9, services/source-connection.md.
 */

import { isDev, devApex, devPort, appApex } from "@/lib/config";
import {
  storeIntegrationCredentials,
  getIntegrationCredentials,
} from "./server";
import {
  listActiveScopeItems,
  markScopeItemSynced,
  type DiscoveredScopeItem,
} from "./source-scope";
import { ingestProviderItems } from "@/modules/ingestion/server";
import type { ProviderRawItem } from "@/modules/ingestion";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

/** Read-only Gmail + Calendar, plus identity. No send/write scopes. */
export const GOOGLE_SCOPE = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

/** Short-lived OAuth state cookie name (Google flow). */
export const GOOGLE_STATE_COOKIE = "paylo_google_oauth";

const SYNC_WINDOW_DAYS = 7;
const MAX_PER_ITEM = 10;

function clientId(): string | undefined {
  return process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || undefined;
}
function clientSecret(): string | undefined {
  return process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || undefined;
}

/** True when both Google OAuth app credentials are configured. */
export function isGoogleOAuthConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

/** Fixed OAuth callback URL on the reserved `app.` host. */
export function googleCallbackUrl(): string {
  return isDev()
    ? `http://app.${devApex()}:${devPort()}/api/oauth/google/callback`
    : `https://app.${appApex()}/api/oauth/google/callback`;
}

/** Build the Google authorize URL for a signed state token. */
export function buildGoogleAuthorizeUrl(stateToken: string): string {
  const id = clientId();
  if (!id) throw new Error("google_oauth_not_configured");
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: googleCallbackUrl(),
    response_type: "code",
    scope: GOOGLE_SCOPE,
    state: stateToken,
    access_type: "offline", // request a refresh token
    prompt: "consent", // ensure refresh token is returned
    include_granted_scopes: "true",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface GoogleToken {
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
  expiresAt: string | null;
}

function expiresAtFrom(expiresIn: number | undefined): string | null {
  if (!expiresIn || Number.isNaN(expiresIn)) return null;
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

/** Exchange an authorisation code for tokens. */
export async function exchangeCodeForToken(code: string): Promise<GoogleToken> {
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) throw new Error("google_oauth_not_configured");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      code,
      redirect_uri: googleCallbackUrl(),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`google_token_exchange_failed_${res.status}`);
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
  };
  if (!data.access_token) throw new Error("google_token_missing");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    scope: data.scope ?? null,
    expiresAt: expiresAtFrom(data.expires_in),
  };
}

async function refreshAccessToken(refreshToken: string): Promise<GoogleToken> {
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) throw new Error("google_oauth_not_configured");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`google_token_refresh_failed_${res.status}`);
  const data = (await res.json()) as {
    access_token?: string;
    scope?: string;
    expires_in?: number;
  };
  if (!data.access_token) throw new Error("google_refresh_missing");
  return {
    accessToken: data.access_token,
    refreshToken, // Google does not return a new refresh token on refresh
    scope: data.scope ?? null,
    expiresAt: expiresAtFrom(data.expires_in),
  };
}

/**
 * Return a valid access token for a connection, refreshing if it has expired
 * (or is within 60s of expiry). Re-stores the refreshed token. Returns null if
 * no credentials are stored.
 */
export async function getValidGoogleToken(
  tenantId: string,
  sourceConnectionId: string,
): Promise<string | null> {
  const creds = await getIntegrationCredentials(tenantId, sourceConnectionId);
  if (!creds?.accessToken) return null;

  const expMs = creds.expiresAt ? Date.parse(creds.expiresAt) : NaN;
  const stillValid = !Number.isNaN(expMs) && expMs > Date.now() + 60_000;
  if (stillValid) return creds.accessToken;

  if (creds.refreshToken) {
    const refreshed = await refreshAccessToken(creds.refreshToken);
    await storeIntegrationCredentials(tenantId, sourceConnectionId, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      scope: refreshed.scope ?? creds.scope,
      expiresAt: refreshed.expiresAt,
    });
    return refreshed.accessToken;
  }
  return creds.accessToken; // best effort; may be expired
}

async function googleGet<T>(token: string, url: string): Promise<T | null> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

// --- Discovery --------------------------------------------------------------

interface GmailLabel {
  id: string;
  name: string;
  type?: string;
}

/** System labels worth surfacing alongside user labels. */
const KEEP_SYSTEM_LABELS = new Set(["INBOX", "STARRED", "IMPORTANT", "SENT"]);

/** Discover Gmail labels (user labels + a few key system labels). */
export async function fetchGmailLabels(token: string): Promise<DiscoveredScopeItem[]> {
  const data = await googleGet<{ labels?: GmailLabel[] }>(
    token,
    `${GMAIL_BASE}/users/me/labels`,
  );
  const out: DiscoveredScopeItem[] = [];
  for (const label of data?.labels ?? []) {
    const isUser = label.type === "user";
    if (!isUser && !KEEP_SYSTEM_LABELS.has(label.id)) continue;
    out.push({ externalId: label.id, itemType: "gmail_label", name: label.name });
  }
  return out;
}

interface GoogleCalendarEntry {
  id: string;
  summary?: string;
  primary?: boolean;
}

/** Discover the user's Google calendars. */
export async function fetchCalendars(token: string): Promise<DiscoveredScopeItem[]> {
  const data = await googleGet<{ items?: GoogleCalendarEntry[] }>(
    token,
    `${CALENDAR_BASE}/users/me/calendarList`,
  );
  return (data?.items ?? []).map((c) => ({
    externalId: c.id,
    itemType: "google_calendar" as const,
    name: c.summary || (c.primary ? "Primary" : c.id),
    metadata: { primary: c.primary ?? false },
  }));
}

// --- Sync -------------------------------------------------------------------

interface GmailMessageRef {
  id: string;
}
interface GmailMessage {
  id: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[] };
}

function header(msg: GmailMessage, name: string): string | null {
  const h = msg.payload?.headers?.find(
    (x) => x.name.toLowerCase() === name.toLowerCase(),
  );
  return h?.value ?? null;
}

/** Sync recent Gmail messages from the operator's *active* labels. */
export async function syncGmail(
  tenantId: string,
  sourceConnectionId: string,
  token: string,
): Promise<{ itemCount: number; scopeCount: number }> {
  const labels = (await listActiveScopeItems(tenantId, sourceConnectionId)).filter(
    (s) => s.itemType === "gmail_label",
  );
  const now = new Date().toISOString();
  let itemCount = 0;

  for (const label of labels) {
    const list = await googleGet<{ messages?: GmailMessageRef[] }>(
      token,
      `${GMAIL_BASE}/users/me/messages?labelIds=${encodeURIComponent(label.externalId)}&q=newer_than:${SYNC_WINDOW_DAYS}d&maxResults=${MAX_PER_ITEM}`,
    );
    const items: ProviderRawItem[] = [];
    for (const ref of list?.messages ?? []) {
      const msg = await googleGet<GmailMessage>(
        token,
        `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(ref.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      );
      if (!msg) continue;
      const subject = header(msg, "Subject") ?? "(no subject)";
      const from = header(msg, "From");
      const occurredAt = msg.internalDate
        ? new Date(Number(msg.internalDate)).toISOString()
        : null;
      items.push({
        externalId: `gmail:${msg.id}`,
        title: subject,
        body: `${from ? `From: ${from}\n` : ""}${msg.snippet ?? ""}`.trim() || subject,
        author: from,
        occurredAt,
        kind: "email",
        raw: { source: "gmail", labelId: label.externalId, messageId: msg.id },
      });
    }
    if (items.length > 0) {
      const r = await ingestProviderItems(tenantId, sourceConnectionId, "email", items);
      itemCount += r.itemCount;
    }
    await markScopeItemSynced(tenantId, label.id, now);
  }
  return { itemCount, scopeCount: labels.length };
}

interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string }[];
}

/** Sync upcoming events (today + window) from the operator's *active* calendars. */
export async function syncCalendar(
  tenantId: string,
  sourceConnectionId: string,
  token: string,
): Promise<{ itemCount: number; scopeCount: number }> {
  const calendars = (await listActiveScopeItems(tenantId, sourceConnectionId)).filter(
    (s) => s.itemType === "google_calendar",
  );
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + SYNC_WINDOW_DAYS * 86_400_000).toISOString();
  const nowIso = now.toISOString();
  let itemCount = 0;

  for (const cal of calendars) {
    const data = await googleGet<{ items?: CalendarEvent[] }>(
      token,
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(cal.externalId)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=${MAX_PER_ITEM}`,
    );
    const items: ProviderRawItem[] = [];
    for (const ev of data?.items ?? []) {
      const start = ev.start?.dateTime ?? ev.start?.date ?? null;
      const attendees = (ev.attendees ?? [])
        .map((a) => a.displayName || a.email)
        .filter(Boolean)
        .join(", ");
      const summary = ev.summary ?? "(busy)";
      items.push({
        externalId: `gcal:${ev.id}`,
        title: summary,
        body:
          `${start ? `When: ${start}\n` : ""}${attendees ? `Attendees: ${attendees}\n` : ""}${ev.description ?? ""}`.trim() ||
          summary,
        author: null,
        occurredAt: start,
        kind: "event",
        raw: { source: "google_calendar", calendarId: cal.externalId, eventId: ev.id, url: ev.htmlLink ?? null },
      });
    }
    if (items.length > 0) {
      const r = await ingestProviderItems(tenantId, sourceConnectionId, "calendar", items);
      itemCount += r.itemCount;
    }
    await markScopeItemSynced(tenantId, cal.id, nowIso);
  }
  return { itemCount, scopeCount: calendars.length };
}
