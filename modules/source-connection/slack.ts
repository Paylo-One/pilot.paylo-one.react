import "server-only";

/**
 * Slack source connector.
 *
 * Public-channel MVP: OAuth installs a workspace app, discovery persists public
 * channels as inactive scope items, and sync incrementally pulls only active
 * channels through the generic source_items ingestion path.
 */

import { Buffer } from "node:buffer";
import { isDev, devApex, devPort, appApex } from "@/lib/config";
import { ingestProviderItems } from "@/modules/ingestion/server";
import type { ProviderRawItem } from "@/modules/ingestion";
import { storeIntegrationCredentials, getIntegrationCredentials } from "./server";
import {
  listActiveScopeItems,
  markScopeItemSyncState,
  type DiscoveredScopeItem,
} from "./source-scope";

const AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const TOKEN_URL = "https://slack.com/api/oauth.v2.access";
const API_BASE = "https://slack.com/api";

export const SLACK_STATE_COOKIE = "paylo_slack_oauth";

export const SLACK_SCOPE = [
  "channels:read",
  "channels:history",
  "users:read",
  "reactions:read",
  "files:read",
  "team:read",
].join(",");

const MAX_PER_CHANNEL = 50;
const MAX_THREAD_REPLIES = 25;

function clientId(): string | undefined {
  return process.env.SLACK_CLIENT_ID?.trim() || undefined;
}

function clientSecret(): string | undefined {
  return process.env.SLACK_CLIENT_SECRET?.trim() || undefined;
}

export function isSlackOAuthConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

export function slackCallbackUrl(): string {
  return isDev()
    ? `http://app.${devApex()}:${devPort()}/api/oauth/slack/callback`
    : `https://app.${appApex()}/api/oauth/slack/callback`;
}

export function buildSlackAuthorizeUrl(stateToken: string): string {
  const id = clientId();
  if (!id) throw new Error("slack_oauth_not_configured");
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: slackCallbackUrl(),
    scope: SLACK_SCOPE,
    state: stateToken,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface SlackToken {
  accessToken: string;
  scope: string | null;
  teamId: string | null;
  teamName: string | null;
  botUserId: string | null;
}

export async function exchangeSlackCode(code: string): Promise<SlackToken> {
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) throw new Error("slack_oauth_not_configured");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ code, redirect_uri: slackCallbackUrl() }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`slack_token_exchange_failed_${res.status}`);
  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    access_token?: string;
    scope?: string;
    team?: { id?: string; name?: string };
    bot_user_id?: string;
  };
  if (!data.ok || !data.access_token) {
    throw new Error(data.error ?? "slack_token_missing");
  }
  return {
    accessToken: data.access_token,
    scope: data.scope ?? null,
    teamId: data.team?.id ?? null,
    teamName: data.team?.name ?? null,
    botUserId: data.bot_user_id ?? null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function slackApi<T>(
  token: string,
  method: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<T | null> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const url = `${API_BASE}/${method}${qs.size ? `?${qs.toString()}` : ""}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "1");
      await sleep(Math.max(0, retryAfter) * 1000);
      continue;
    }
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; error?: string } & T;
    if (data.ok === false) return null;
    return data as T;
  }
  return null;
}

interface SlackChannel {
  id: string;
  name?: string;
  is_channel?: boolean;
  is_archived?: boolean;
  is_private?: boolean;
  num_members?: number;
}

export async function fetchSlackPublicChannels(token: string): Promise<DiscoveredScopeItem[]> {
  const out: DiscoveredScopeItem[] = [];
  let cursor: string | undefined;
  do {
    const data = await slackApi<{
      channels?: SlackChannel[];
      response_metadata?: { next_cursor?: string };
    }>(token, "conversations.list", {
      types: "public_channel",
      exclude_archived: true,
      limit: 200,
      cursor,
    });
    for (const channel of data?.channels ?? []) {
      if (!channel.id || channel.is_private || channel.is_archived) continue;
      out.push({
        externalId: channel.id,
        itemType: "slack_channel",
        name: `#${channel.name ?? channel.id}`,
        metadata: {
          public: true,
          memberCount: channel.num_members ?? null,
        },
      });
    }
    cursor = data?.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return out;
}

export async function getValidSlackToken(
  tenantId: string,
  sourceConnectionId: string,
): Promise<string | null> {
  const creds = await getIntegrationCredentials(tenantId, sourceConnectionId);
  return creds?.accessToken || null;
}

interface SlackMessage {
  type?: string;
  subtype?: string;
  user?: string;
  username?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  reply_count?: number;
  reactions?: { name?: string; count?: number; users?: string[] }[];
  files?: { id?: string; name?: string; title?: string; mimetype?: string; url_private?: string }[];
  attachments?: { title?: string; text?: string; title_link?: string; from_url?: string }[];
}

const LINK_RE = /https?:\/\/[^\s<>)]+/g;

function slackTsToIso(ts: string | undefined): string | null {
  if (!ts) return null;
  const seconds = Number(ts.split(".")[0]);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
}

function formatSlackItem(
  msg: SlackMessage,
  channel: { id: string; name: string | null; scopeItemId: string },
  teamId: string | null,
): ProviderRawItem | null {
  if (!msg.ts || msg.subtype === "channel_join" || msg.subtype === "channel_leave") return null;
  const text = (msg.text ?? "").trim();
  const attachmentText = (msg.attachments ?? [])
    .map((a) => [a.title, a.text, a.title_link ?? a.from_url].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n");
  const fileText = (msg.files ?? [])
    .map((f) => [f.title ?? f.name, f.mimetype].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n");
  const body = [text, attachmentText, fileText].filter(Boolean).join("\n").trim();
  if (!body) return null;

  const author = msg.user ?? msg.username ?? null;
  const reactions = (msg.reactions ?? [])
    .map((r) => `${r.name ?? "reaction"}:${r.count ?? 0}`)
    .join(", ");
  const links = body.match(LINK_RE) ?? [];
  const isReply = msg.thread_ts && msg.thread_ts !== msg.ts;
  const title = `${channel.name ?? "Slack"} ${isReply ? "thread reply" : "message"}: ${body.slice(0, 80)}`;
  return {
    externalId: `slack:${channel.id}:${msg.ts}`,
    title,
    body:
      `${author ? `${author}: ` : ""}${body}` +
      `${reactions ? `\nReactions: ${reactions}` : ""}` +
      `${links.length > 0 ? `\nLinks: ${links.join(", ")}` : ""}`,
    author,
    occurredAt: slackTsToIso(msg.ts),
    kind: "message",
    raw: {
      source: "slack",
      teamId,
      channelId: channel.id,
      channelName: channel.name,
      scopeItemId: channel.scopeItemId,
      messageTs: msg.ts,
      threadTs: msg.thread_ts ?? null,
      replyCount: msg.reply_count ?? 0,
      reactions: msg.reactions ?? [],
      links,
      attachments: msg.attachments ?? [],
      files: msg.files ?? [],
    },
  };
}

async function fetchSlackThreadReplies(
  token: string,
  channelId: string,
  threadTs: string,
  oldest?: string | null,
): Promise<SlackMessage[]> {
  const data = await slackApi<{ messages?: SlackMessage[] }>(token, "conversations.replies", {
    channel: channelId,
    ts: threadTs,
    oldest: oldest || undefined,
    inclusive: false,
    limit: MAX_THREAD_REPLIES,
  });
  return data?.messages?.slice(1) ?? [];
}

export async function syncSlackChannels(
  tenantId: string,
  sourceConnectionId: string,
  token: string,
): Promise<{ itemCount: number; scopeCount: number }> {
  const channels = (await listActiveScopeItems(tenantId, sourceConnectionId)).filter(
    (s) => s.itemType === "slack_channel",
  );
  const creds = await getIntegrationCredentials(tenantId, sourceConnectionId);
  let teamId: string | null = null;
  if (creds?.scope?.startsWith("{")) {
    try {
      teamId = (JSON.parse(creds.scope) as { teamId?: string }).teamId ?? null;
    } catch {
      teamId = null;
    }
  }
  const nowIso = new Date().toISOString();
  let itemCount = 0;

  for (const channel of channels) {
    const data = await slackApi<{ messages?: SlackMessage[] }>(token, "conversations.history", {
      channel: channel.externalId,
      oldest: channel.syncCursor || undefined,
      inclusive: false,
      limit: MAX_PER_CHANNEL,
    });
    const messages = [...(data?.messages ?? [])].reverse();
    const items: ProviderRawItem[] = [];
    let maxTs = channel.syncCursor;
    for (const msg of messages) {
      const item = formatSlackItem(
        msg,
        { id: channel.externalId, name: channel.name, scopeItemId: channel.id },
        teamId,
      );
      if (item) items.push(item);
      if (msg.reply_count && msg.ts) {
        const replies = await fetchSlackThreadReplies(token, channel.externalId, msg.ts, channel.syncCursor);
        for (const reply of replies) {
          const replyItem = formatSlackItem(
            reply,
            { id: channel.externalId, name: channel.name, scopeItemId: channel.id },
            teamId,
          );
          if (replyItem) items.push(replyItem);
          if (reply.ts && (!maxTs || Number(reply.ts) > Number(maxTs))) maxTs = reply.ts;
        }
      }
      if (msg.ts && (!maxTs || Number(msg.ts) > Number(maxTs))) maxTs = msg.ts;
    }
    if (items.length > 0) {
      const r = await ingestProviderItems(tenantId, sourceConnectionId, "slack", items);
      itemCount += r.itemCount;
    }
    await markScopeItemSyncState(tenantId, channel.id, { when: nowIso, syncCursor: maxTs });
  }

  return { itemCount, scopeCount: channels.length };
}

export async function storeSlackToken(
  tenantId: string,
  sourceConnectionId: string,
  token: SlackToken,
): Promise<void> {
  await storeIntegrationCredentials(tenantId, sourceConnectionId, {
    accessToken: token.accessToken,
    scope: JSON.stringify({
      scopes: token.scope,
      teamId: token.teamId,
      teamName: token.teamName,
      botUserId: token.botUserId,
    }),
  });
}
