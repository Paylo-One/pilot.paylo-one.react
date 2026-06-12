import "server-only";

/**
 * modules/source-connection/microsoft.ts
 *
 * Shared Microsoft Entra OAuth client for the Microsoft 365 family —
 * **MS 365 Mail (Exchange Online: mail + calendars)** and **Teams**. One Azure
 * app registration serves both, but each connector runs its OWN consent with
 * its own least-privilege scope set (ADR-027: the operator authorises and
 * revokes the exact connector, never a bundle). Discovery lists mail folders /
 * calendars / chats / channels as selectable scope items; sync pulls **only**
 * from active items.
 *
 * Teams consent model (ADR-037): `Chat.Read` is user-consentable and is the
 * dependable path. Channel messages (`ChannelMessage.Read.All`) require
 * tenant-admin consent — requested only via the `channels=1` start variant;
 * channel sync degrades gracefully (skips, reports) when Graph returns 403.
 *
 * Server-only: reads OAuth app credentials, talks to Microsoft over HTTPS,
 * refreshes expiring tokens (Entra rotates refresh tokens — always re-store).
 * Reuses the signed-state helpers from ./github (generic tenant-context CSRF
 * state; not GitHub-specific logic).
 *
 * Governance: integration-architecture.md (MS 365 — Mail, Teams),
 * source-integration-strategy.md §8/§10, ADR-027, ADR-037.
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

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** Which Microsoft 365 connector a flow is for. */
export type MicrosoftProduct = "mail" | "teams";

/** Short-lived OAuth state cookie names (Microsoft flow). */
export const MICROSOFT_STATE_COOKIE = "paylo_microsoft_oauth";
export const MICROSOFT_PRODUCT_COOKIE = "paylo_microsoft_oauth_product";

const SYNC_WINDOW_DAYS = 7;
const MAX_PER_ITEM = 10;
const MAX_TEAMS = 20;

function clientId(): string | undefined {
  return process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim() || undefined;
}
function clientSecret(): string | undefined {
  return process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim() || undefined;
}

/**
 * Entra tenant segment of the authority. `organizations` (default) allows any
 * work/school account; pin to a directory (tenant) ID for single-org installs.
 */
function entraTenant(): string {
  return process.env.MICROSOFT_OAUTH_TENANT?.trim() || "organizations";
}

/** True when both Microsoft OAuth app credentials are configured. */
export function isMicrosoftOAuthConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

function authorizeUrl(): string {
  return `https://login.microsoftonline.com/${entraTenant()}/oauth2/v2.0/authorize`;
}
function tokenUrl(): string {
  return `https://login.microsoftonline.com/${entraTenant()}/oauth2/v2.0/token`;
}

/** Fixed OAuth callback URL on the reserved `app.` host. */
export function microsoftCallbackUrl(): string {
  return isDev()
    ? `http://app.${devApex()}:${devPort()}/api/oauth/microsoft/callback`
    : `https://app.${appApex()}/api/oauth/microsoft/callback`;
}

/**
 * Least-privilege delegated scope set per connector. Read-only Graph scopes
 * only — never send/write (ADR-027). `offline_access` yields a refresh token.
 */
export function microsoftScope(
  product: MicrosoftProduct,
  opts?: { includeChannels?: boolean },
): string {
  const base = ["openid", "email", "offline_access"];
  if (product === "mail") {
    return [
      ...base,
      "https://graph.microsoft.com/Mail.Read",
      "https://graph.microsoft.com/Calendars.Read",
    ].join(" ");
  }
  const teams = [
    ...base,
    "https://graph.microsoft.com/Chat.Read",
    "https://graph.microsoft.com/Team.ReadBasic.All",
    "https://graph.microsoft.com/Channel.ReadBasic.All",
  ];
  // Channel MESSAGES need tenant-admin consent; only request when asked for,
  // otherwise non-admin operators would hit the "Need admin approval" wall.
  if (opts?.includeChannels) {
    teams.push("https://graph.microsoft.com/ChannelMessage.Read.All");
  }
  return teams.join(" ");
}

/** Build the Entra authorize URL for a signed state token. */
export function buildMicrosoftAuthorizeUrl(
  stateToken: string,
  product: MicrosoftProduct,
  opts?: { includeChannels?: boolean },
): string {
  const id = clientId();
  if (!id) throw new Error("microsoft_oauth_not_configured");
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: microsoftCallbackUrl(),
    response_type: "code",
    response_mode: "query",
    scope: microsoftScope(product, opts),
    state: stateToken,
    prompt: "select_account",
  });
  return `${authorizeUrl()}?${params.toString()}`;
}

export interface MicrosoftToken {
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
  expiresAt: string | null;
}

function expiresAtFrom(expiresIn: number | undefined): string | null {
  if (!expiresIn || Number.isNaN(expiresIn)) return null;
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

async function tokenRequest(body: URLSearchParams): Promise<MicrosoftToken> {
  const res = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`microsoft_token_request_failed_${res.status}`);
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
  };
  if (!data.access_token) throw new Error("microsoft_token_missing");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    scope: data.scope ?? null,
    expiresAt: expiresAtFrom(data.expires_in),
  };
}

/** Exchange an authorisation code for tokens. */
export async function exchangeMicrosoftCode(code: string): Promise<MicrosoftToken> {
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) throw new Error("microsoft_oauth_not_configured");
  return tokenRequest(
    new URLSearchParams({
      client_id: id,
      client_secret: secret,
      code,
      redirect_uri: microsoftCallbackUrl(),
      grant_type: "authorization_code",
    }),
  );
}

async function refreshAccessToken(refreshToken: string): Promise<MicrosoftToken> {
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) throw new Error("microsoft_oauth_not_configured");
  const token = await tokenRequest(
    new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  );
  // Entra rotates refresh tokens; keep the old one only if none was returned.
  return { ...token, refreshToken: token.refreshToken ?? refreshToken };
}

/**
 * Return a valid access token for a connection, refreshing if it has expired
 * (or is within 60s of expiry). Re-stores the refreshed token (Entra rotates
 * refresh tokens). Returns null if no credentials are stored.
 */
export async function getValidMicrosoftToken(
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

async function graphGet<T>(token: string, url: string): Promise<T | null> {
  const res = await graphGetWithStatus<T>(token, url);
  return res.data;
}

/** Graph GET that surfaces the status (for admin-consent 403 degradation). */
async function graphGetWithStatus<T>(
  token: string,
  url: string,
): Promise<{ status: number; data: T | null }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return { status: res.status, data: null };
  return { status: res.status, data: (await res.json()) as T };
}

/** Crude HTML → text for Teams message bodies (Graph returns HTML content). */
function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Discovery ---------------------------------------------------------------

interface GraphMailFolder {
  id: string;
  displayName?: string;
  totalItemCount?: number;
}

/** Discover the mailbox's folders (top level; Inbox etc.). */
export async function fetchMailFolders(token: string): Promise<DiscoveredScopeItem[]> {
  const data = await graphGet<{ value?: GraphMailFolder[] }>(
    token,
    `${GRAPH_BASE}/me/mailFolders?$top=50`,
  );
  return (data?.value ?? []).map((f) => ({
    externalId: f.id,
    itemType: "ms365_folder" as const,
    name: f.displayName || f.id,
    metadata: { totalItemCount: f.totalItemCount ?? null },
  }));
}

interface GraphCalendar {
  id: string;
  name?: string;
  isDefaultCalendar?: boolean;
}

/** Discover the user's Microsoft 365 calendars. */
export async function fetchMs365Calendars(token: string): Promise<DiscoveredScopeItem[]> {
  const data = await graphGet<{ value?: GraphCalendar[] }>(
    token,
    `${GRAPH_BASE}/me/calendars?$top=50`,
  );
  return (data?.value ?? []).map((c) => ({
    externalId: c.id,
    itemType: "ms365_calendar" as const,
    name: c.name || (c.isDefaultCalendar ? "Calendar" : c.id),
    metadata: { isDefault: c.isDefaultCalendar ?? false },
  }));
}

interface GraphChat {
  id: string;
  topic?: string | null;
  chatType?: string;
  members?: { displayName?: string }[];
}

/** Discover the operator's Teams chats (DMs + group chats; user-consentable). */
export async function fetchTeamsChats(token: string): Promise<DiscoveredScopeItem[]> {
  const data = await graphGet<{ value?: GraphChat[] }>(
    token,
    `${GRAPH_BASE}/me/chats?$top=50&$expand=members`,
  );
  return (data?.value ?? []).map((chat) => {
    const members = (chat.members ?? [])
      .map((m) => m.displayName)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    return {
      externalId: chat.id,
      itemType: "teams_chat" as const,
      name: chat.topic || members || chat.id,
      metadata: { chatType: chat.chatType ?? null },
    };
  });
}

interface GraphTeam {
  id: string;
  displayName?: string;
}
interface GraphChannel {
  id: string;
  displayName?: string;
}

/**
 * Discover channels across the operator's joined teams. ReadBasic listing is
 * user-consentable; message access still needs admin consent — discovery is
 * best-effort and returns [] when Graph denies it.
 */
export async function fetchTeamsChannels(token: string): Promise<DiscoveredScopeItem[]> {
  const teams = await graphGet<{ value?: GraphTeam[] }>(
    token,
    `${GRAPH_BASE}/me/joinedTeams`,
  );
  const out: DiscoveredScopeItem[] = [];
  for (const team of (teams?.value ?? []).slice(0, MAX_TEAMS)) {
    const channels = await graphGet<{ value?: GraphChannel[] }>(
      token,
      `${GRAPH_BASE}/teams/${encodeURIComponent(team.id)}/channels`,
    );
    for (const channel of channels?.value ?? []) {
      out.push({
        // teamId/channelId — sync needs both halves to address messages.
        externalId: `${team.id}/${channel.id}`,
        itemType: "teams_channel" as const,
        name: `${team.displayName ?? "Team"} › ${channel.displayName ?? channel.id}`,
        metadata: { teamId: team.id, channelId: channel.id },
      });
    }
  }
  return out;
}

// --- Sync ---------------------------------------------------------------------

interface GraphMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  webLink?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
}

function mailAuthor(msg: GraphMessage): string | null {
  const addr = msg.from?.emailAddress;
  if (!addr?.address) return addr?.name ?? null;
  return addr.name ? `${addr.name} <${addr.address}>` : addr.address;
}

interface GraphEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  webLink?: string;
  start?: { dateTime?: string; timeZone?: string };
  attendees?: { emailAddress?: { name?: string; address?: string } }[];
}

/**
 * Sync recent mail from the operator's *active* folders plus upcoming events
 * from *active* calendars (one ms365_mail connection covers Exchange mail +
 * calendar, mirroring the one-grant Google family).
 */
export async function syncMs365Mail(
  tenantId: string,
  sourceConnectionId: string,
  token: string,
): Promise<{ itemCount: number; scopeCount: number }> {
  const scope = await listActiveScopeItems(tenantId, sourceConnectionId);
  const folders = scope.filter((s) => s.itemType === "ms365_folder");
  const calendars = scope.filter((s) => s.itemType === "ms365_calendar");
  const now = new Date();
  const nowIso = now.toISOString();
  const since = new Date(now.getTime() - SYNC_WINDOW_DAYS * 86_400_000).toISOString();
  const until = new Date(now.getTime() + SYNC_WINDOW_DAYS * 86_400_000).toISOString();
  let itemCount = 0;

  for (const folder of folders) {
    const data = await graphGet<{ value?: GraphMessage[] }>(
      token,
      `${GRAPH_BASE}/me/mailFolders/${encodeURIComponent(folder.externalId)}/messages` +
        `?$top=${MAX_PER_ITEM}&$orderby=receivedDateTime desc` +
        `&$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}` +
        `&$select=id,subject,bodyPreview,receivedDateTime,webLink,from`,
    );
    const items: ProviderRawItem[] = [];
    for (const msg of data?.value ?? []) {
      const subject = msg.subject || "(no subject)";
      const from = mailAuthor(msg);
      items.push({
        externalId: `ms365:${msg.id}`,
        title: subject,
        body: `${from ? `From: ${from}\n` : ""}${msg.bodyPreview ?? ""}`.trim() || subject,
        author: from,
        occurredAt: msg.receivedDateTime ?? null,
        kind: "email",
        raw: {
          source: "ms365_mail",
          folderId: folder.externalId,
          messageId: msg.id,
          url: msg.webLink ?? null,
        },
      });
    }
    if (items.length > 0) {
      const r = await ingestProviderItems(tenantId, sourceConnectionId, "ms365_mail", items);
      itemCount += r.itemCount;
    }
    await markScopeItemSynced(tenantId, folder.id, nowIso);
  }

  for (const cal of calendars) {
    const data = await graphGet<{ value?: GraphEvent[] }>(
      token,
      `${GRAPH_BASE}/me/calendars/${encodeURIComponent(cal.externalId)}/calendarView` +
        `?startDateTime=${encodeURIComponent(nowIso)}&endDateTime=${encodeURIComponent(until)}` +
        `&$top=${MAX_PER_ITEM}&$orderby=start/dateTime` +
        `&$select=id,subject,bodyPreview,webLink,start,attendees`,
    );
    const items: ProviderRawItem[] = [];
    for (const ev of data?.value ?? []) {
      const start = ev.start?.dateTime ?? null;
      const attendees = (ev.attendees ?? [])
        .map((a) => a.emailAddress?.name || a.emailAddress?.address)
        .filter(Boolean)
        .join(", ");
      const summary = ev.subject || "(busy)";
      items.push({
        externalId: `ms365cal:${ev.id}`,
        title: summary,
        body:
          `${start ? `When: ${start}\n` : ""}${attendees ? `Attendees: ${attendees}\n` : ""}${ev.bodyPreview ?? ""}`.trim() ||
          summary,
        author: null,
        occurredAt: start,
        kind: "event",
        raw: {
          source: "ms365_calendar",
          calendarId: cal.externalId,
          eventId: ev.id,
          url: ev.webLink ?? null,
        },
      });
    }
    if (items.length > 0) {
      const r = await ingestProviderItems(tenantId, sourceConnectionId, "ms365_mail", items);
      itemCount += r.itemCount;
    }
    await markScopeItemSynced(tenantId, cal.id, nowIso);
  }

  return { itemCount, scopeCount: folders.length + calendars.length };
}

interface GraphChatMessage {
  id: string;
  createdDateTime?: string;
  body?: { content?: string; contentType?: string };
  from?: { user?: { displayName?: string } } | null;
}

function chatMessageItems(
  messages: readonly GraphChatMessage[],
  scopeName: string | null,
  raw: Record<string, unknown>,
): ProviderRawItem[] {
  const items: ProviderRawItem[] = [];
  for (const msg of messages) {
    const text = htmlToText(msg.body?.content ?? "");
    if (!text) continue; // system events / empty bodies
    const author = msg.from?.user?.displayName ?? null;
    items.push({
      externalId: `teams:${msg.id}`,
      title: `${scopeName ?? "Teams"}: ${text.slice(0, 80)}`,
      body: `${author ? `${author}: ` : ""}${text}`,
      author,
      occurredAt: msg.createdDateTime ?? null,
      kind: "message",
      raw: { ...raw, messageId: msg.id },
    });
  }
  return items;
}

/**
 * Sync recent messages from the operator's *active* Teams chats and channels.
 * Channel reads need tenant-admin consent — a 403 marks the channel skipped
 * (`deniedCount`) instead of failing the whole sync (ADR-037 degradation).
 */
export async function syncTeams(
  tenantId: string,
  sourceConnectionId: string,
  token: string,
): Promise<{ itemCount: number; scopeCount: number; deniedCount: number }> {
  const scope = await listActiveScopeItems(tenantId, sourceConnectionId);
  const chats = scope.filter((s) => s.itemType === "teams_chat");
  const channels = scope.filter((s) => s.itemType === "teams_channel");
  const nowIso = new Date().toISOString();
  let itemCount = 0;
  let deniedCount = 0;

  for (const chat of chats) {
    const data = await graphGet<{ value?: GraphChatMessage[] }>(
      token,
      `${GRAPH_BASE}/me/chats/${encodeURIComponent(chat.externalId)}/messages?$top=${MAX_PER_ITEM}`,
    );
    const items = chatMessageItems(data?.value ?? [], chat.name, {
      source: "teams_chat",
      chatId: chat.externalId,
    });
    if (items.length > 0) {
      const r = await ingestProviderItems(tenantId, sourceConnectionId, "teams", items);
      itemCount += r.itemCount;
    }
    await markScopeItemSynced(tenantId, chat.id, nowIso);
  }

  for (const channel of channels) {
    const [teamId, channelId] = channel.externalId.split("/");
    if (!teamId || !channelId) continue;
    const res = await graphGetWithStatus<{ value?: GraphChatMessage[] }>(
      token,
      `${GRAPH_BASE}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages?$top=${MAX_PER_ITEM}`,
    );
    if (res.status === 403) {
      deniedCount += 1; // needs ChannelMessage.Read.All (tenant-admin consent)
      continue;
    }
    const items = chatMessageItems(res.data?.value ?? [], channel.name, {
      source: "teams_channel",
      teamId,
      channelId,
    });
    if (items.length > 0) {
      const r = await ingestProviderItems(tenantId, sourceConnectionId, "teams", items);
      itemCount += r.itemCount;
    }
    await markScopeItemSynced(tenantId, channel.id, nowIso);
  }

  return { itemCount, scopeCount: chats.length + channels.length, deniedCount };
}
