import "server-only";

/**
 * Discord source connector.
 *
 * Best-practice MVP uses OAuth2 to install/authorise the application and a bot
 * token for server/channel reads. Channel selection reuses source_scope_items;
 * sync pulls only active channels and active threads visible to the bot.
 */

import { Buffer } from "node:buffer";
import { isDev, devApex, devPort, appApex } from "@/lib/config";
import { ingestProviderItems } from "@/modules/ingestion/server";
import type { ProviderRawItem } from "@/modules/ingestion";
import { getIntegrationCredentials, storeIntegrationCredentials } from "./server";
import {
  listActiveScopeItems,
  markScopeItemSyncState,
  type DiscoveredScopeItem,
} from "./source-scope";

const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const TOKEN_URL = "https://discord.com/api/v10/oauth2/token";
const API_BASE = "https://discord.com/api/v10";

export const DISCORD_STATE_COOKIE = "paylo_discord_oauth";
export const DISCORD_SCOPE = "identify guilds bot";
const BOT_PERMISSIONS = "66560"; // View Channel + Read Message History.
const MAX_PER_CHANNEL = 50;
const MAX_THREADS_PER_GUILD = 100;

function clientId(): string | undefined {
  return process.env.DISCORD_CLIENT_ID?.trim() || undefined;
}

function clientSecret(): string | undefined {
  return process.env.DISCORD_CLIENT_SECRET?.trim() || undefined;
}

function botToken(): string | undefined {
  return process.env.DISCORD_BOT_TOKEN?.trim() || undefined;
}

export function isDiscordOAuthConfigured(): boolean {
  return Boolean(clientId() && clientSecret() && botToken());
}

export function discordCallbackUrl(): string {
  return isDev()
    ? `http://app.${devApex()}:${devPort()}/api/oauth/discord/callback`
    : `https://app.${appApex()}/api/oauth/discord/callback`;
}

export function buildDiscordAuthorizeUrl(stateToken: string): string {
  const id = clientId();
  if (!id) throw new Error("discord_oauth_not_configured");
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: discordCallbackUrl(),
    response_type: "code",
    scope: DISCORD_SCOPE,
    permissions: BOT_PERMISSIONS,
    state: stateToken,
    prompt: "consent",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface DiscordToken {
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
  expiresAt: string | null;
}

function expiresAtFrom(expiresIn: number | undefined): string | null {
  if (!expiresIn || Number.isNaN(expiresIn)) return null;
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

export async function exchangeDiscordCode(code: string): Promise<DiscordToken> {
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) throw new Error("discord_oauth_not_configured");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: discordCallbackUrl(),
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`discord_token_exchange_failed_${res.status}`);
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
  };
  if (!data.access_token) throw new Error("discord_token_missing");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    scope: data.scope ?? null,
    expiresAt: expiresAtFrom(data.expires_in),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discordGet<T>(
  token: string,
  path: string,
  auth: "bot" | "bearer" = "bot",
): Promise<{ status: number; data: T | null }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `${auth === "bot" ? "Bot" : "Bearer"} ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (res.status === 429) {
      const body = (await res.json().catch(() => null)) as { retry_after?: number } | null;
      const retryAfter = body?.retry_after ?? Number(res.headers.get("retry-after") ?? "1");
      await sleep(Math.max(0.25, retryAfter) * 1000);
      continue;
    }
    if (!res.ok) return { status: res.status, data: null };
    return { status: res.status, data: (await res.json()) as T };
  }
  return { status: 429, data: null };
}

interface DiscordGuild {
  id: string;
  name: string;
}

interface DiscordChannel {
  id: string;
  guild_id?: string;
  parent_id?: string | null;
  name?: string;
  type: number;
}

const SYNCABLE_CHANNEL_TYPES = new Set([0, 5]); // text, announcement
const THREAD_TYPES = new Set([10, 11, 12]);

export async function fetchDiscordGuildChannels(userAccessToken: string): Promise<DiscoveredScopeItem[]> {
  const bot = botToken();
  if (!bot) throw new Error("discord_bot_token_not_configured");
  const guilds = await discordGet<DiscordGuild[]>(userAccessToken, "/users/@me/guilds", "bearer");
  const out: DiscoveredScopeItem[] = [];
  for (const guild of guilds.data ?? []) {
    const channels = await discordGet<DiscordChannel[]>(bot, `/guilds/${guild.id}/channels`);
    if (channels.status === 403 || channels.status === 404) continue;
    for (const channel of channels.data ?? []) {
      if (!SYNCABLE_CHANNEL_TYPES.has(channel.type)) continue;
      out.push({
        externalId: channel.id,
        itemType: "discord_channel",
        name: `${guild.name} #${channel.name ?? channel.id}`,
        metadata: {
          guildId: guild.id,
          guildName: guild.name,
          channelId: channel.id,
          channelType: channel.type,
        },
      });
    }
  }
  return out;
}

export async function getValidDiscordToken(
  _tenantId: string,
  _sourceConnectionId: string,
): Promise<string | null> {
  return botToken() ?? null;
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  content?: string;
  timestamp?: string;
  author?: { id?: string; username?: string; global_name?: string | null };
  attachments?: { id?: string; filename?: string; url?: string; content_type?: string }[];
  embeds?: { title?: string; description?: string; url?: string }[];
  reactions?: { count?: number; emoji?: { name?: string } }[];
  message_reference?: { channel_id?: string; message_id?: string; guild_id?: string };
}

const LINK_RE = /https?:\/\/[^\s<>)]+/g;

function formatDiscordItem(
  msg: DiscordMessage,
  channel: {
    id: string;
    name: string | null;
    guildId: string | null;
    guildName: string | null;
    scopeItemId: string;
    threadId?: string | null;
    threadName?: string | null;
  },
): ProviderRawItem | null {
  const text = (msg.content ?? "").trim();
  const attachmentText = (msg.attachments ?? [])
    .map((a) => [a.filename, a.content_type, a.url].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n");
  const embedText = (msg.embeds ?? [])
    .map((e) => [e.title, e.description, e.url].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n");
  const body = [text, attachmentText, embedText].filter(Boolean).join("\n").trim();
  if (!body) return null;
  const author = msg.author?.global_name || msg.author?.username || msg.author?.id || null;
  const reactions = (msg.reactions ?? [])
    .map((r) => `${r.emoji?.name ?? "reaction"}:${r.count ?? 0}`)
    .join(", ");
  const links = body.match(LINK_RE) ?? [];
  const location = channel.threadName
    ? `${channel.name ?? "Discord"} / ${channel.threadName}`
    : channel.name ?? "Discord";
  return {
    externalId: `discord:${msg.channel_id}:${msg.id}`,
    title: `${location}: ${body.slice(0, 80)}`,
    body:
      `${author ? `${author}: ` : ""}${body}` +
      `${reactions ? `\nReactions: ${reactions}` : ""}` +
      `${links.length > 0 ? `\nLinks: ${links.join(", ")}` : ""}`,
    author,
    occurredAt: msg.timestamp ?? null,
    kind: "message",
    raw: {
      source: "discord",
      guildId: channel.guildId,
      guildName: channel.guildName,
      channelId: channel.id,
      channelName: channel.name,
      threadId: channel.threadId ?? null,
      threadName: channel.threadName ?? null,
      scopeItemId: channel.scopeItemId,
      messageId: msg.id,
      authorId: msg.author?.id ?? null,
      reactions: msg.reactions ?? [],
      links,
      attachments: msg.attachments ?? [],
      embeds: msg.embeds ?? [],
    },
  };
}

async function activeThreadsForGuild(
  token: string,
  guildId: string,
  parentChannelId: string,
): Promise<DiscordChannel[]> {
  const res = await discordGet<{ threads?: DiscordChannel[] }>(token, `/guilds/${guildId}/threads/active`);
  return (res.data?.threads ?? [])
    .filter((thread) => THREAD_TYPES.has(thread.type) && thread.parent_id === parentChannelId)
    .slice(0, MAX_THREADS_PER_GUILD);
}

export async function syncDiscordChannels(
  tenantId: string,
  sourceConnectionId: string,
  token: string,
): Promise<{ itemCount: number; scopeCount: number; deniedCount: number }> {
  const channels = (await listActiveScopeItems(tenantId, sourceConnectionId)).filter(
    (s) => s.itemType === "discord_channel",
  );
  const nowIso = new Date().toISOString();
  let itemCount = 0;
  let deniedCount = 0;

  for (const channel of channels) {
    const metadata = channel.metadata ?? {};
    const guildId = typeof metadata.guildId === "string" ? metadata.guildId : null;
    const guildName = typeof metadata.guildName === "string" ? metadata.guildName : null;
    const qs = new URLSearchParams({ limit: String(MAX_PER_CHANNEL) });
    if (channel.syncCursor) qs.set("after", channel.syncCursor);
    const res = await discordGet<DiscordMessage[]>(
      token,
      `/channels/${channel.externalId}/messages?${qs.toString()}`,
    );
    if (res.status === 403) {
      deniedCount += 1;
      continue;
    }

    const messages = [...(res.data ?? [])].reverse();
    const items: ProviderRawItem[] = [];
    let maxCursor = channel.syncCursor;
    for (const msg of messages) {
      const item = formatDiscordItem(msg, {
        id: channel.externalId,
        name: channel.name,
        guildId,
        guildName,
        scopeItemId: channel.id,
      });
      if (item) items.push(item);
      if (!maxCursor || BigInt(msg.id) > BigInt(maxCursor)) maxCursor = msg.id;
    }

    if (guildId) {
      const threads = await activeThreadsForGuild(token, guildId, channel.externalId);
      for (const thread of threads) {
        const threadQs = new URLSearchParams({ limit: String(MAX_PER_CHANNEL) });
        if (channel.syncCursor) threadQs.set("after", channel.syncCursor);
        const threadMessages = await discordGet<DiscordMessage[]>(
          token,
          `/channels/${thread.id}/messages?${threadQs.toString()}`,
        );
        if (threadMessages.status === 403) continue;
        for (const msg of [...(threadMessages.data ?? [])].reverse()) {
          const item = formatDiscordItem(msg, {
            id: channel.externalId,
            name: channel.name,
            guildId,
            guildName,
            scopeItemId: channel.id,
            threadId: thread.id,
            threadName: thread.name ?? thread.id,
          });
          if (item) items.push(item);
          if (!maxCursor || BigInt(msg.id) > BigInt(maxCursor)) maxCursor = msg.id;
        }
      }
    }

    if (items.length > 0) {
      const r = await ingestProviderItems(tenantId, sourceConnectionId, "discord", items);
      itemCount += r.itemCount;
    }
    await markScopeItemSyncState(tenantId, channel.id, { when: nowIso, syncCursor: maxCursor });
  }

  return { itemCount, scopeCount: channels.length, deniedCount };
}

export async function storeDiscordToken(
  tenantId: string,
  sourceConnectionId: string,
  token: DiscordToken,
): Promise<void> {
  await storeIntegrationCredentials(tenantId, sourceConnectionId, {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    scope: token.scope,
    expiresAt: token.expiresAt,
  });
}

export async function getStoredDiscordOAuthToken(
  tenantId: string,
  sourceConnectionId: string,
): Promise<string | null> {
  const creds = await getIntegrationCredentials(tenantId, sourceConnectionId);
  return creds?.accessToken || null;
}
