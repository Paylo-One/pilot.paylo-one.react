import "server-only";

/**
 * modules/knowledge-store/server.ts
 *
 * Server-only data helpers for the canonical store of normalised items +
 * summaries. Shared by the sources lane (writes items) and the intelligence
 * lane (reads items to assemble the Daily Memo). All helpers take an explicit
 * tenantId; writes use the secret client (service_role) and ALWAYS scope by
 * tenant_id. Governance: services/knowledge-store.md, data-architecture.md.
 */

import type { SourceSystem } from "@/modules/shared";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";

export interface SourceItemInput {
  sourceConnectionId?: string | null;
  system: SourceSystem;
  externalId?: string | null;
  kind?: string | null;
  title?: string | null;
  body?: string | null;
  author?: string | null;
  occurredAt?: string | null;
  raw?: Record<string, unknown> | null;
}

export interface StoredSourceItem {
  id: string;
  system: string;
  title: string | null;
  body: string | null;
  author: string | null;
  occurredAt: string | null;
  createdAt: string;
  raw?: Record<string, unknown> | null;
}

/** Insert one normalised source item for a tenant. Returns the new id. */
export async function insertSourceItem(
  tenantId: string,
  item: SourceItemInput,
): Promise<string> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("source_items")
    .insert({
      tenant_id: tenantId,
      source_connection_id: item.sourceConnectionId ?? null,
      system: item.system,
      external_id: item.externalId ?? null,
      kind: item.kind ?? null,
      title: item.title ?? null,
      body: item.body ?? null,
      author: item.author ?? null,
      occurred_at: item.occurredAt ?? null,
      raw: item.raw ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "insert_source_item_failed");
  return data.id as string;
}

function mapStoredItem(r: Record<string, unknown>): StoredSourceItem {
  return {
    id: r.id as string,
    system: r.system as string,
    title: (r.title as string | null) ?? null,
    body: (r.body as string | null) ?? null,
    author: (r.author as string | null) ?? null,
    occurredAt: (r.occurred_at as string | null) ?? null,
    createdAt: r.created_at as string,
    raw: (r.raw as Record<string, unknown> | null) ?? null,
  };
}

/** Most recent source items for a tenant (newest first). */
export async function listRecentSourceItems(
  tenantId: string,
  limit = 25,
): Promise<StoredSourceItem[]> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("source_items")
    .select("id, system, title, body, author, occurred_at, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapStoredItem);
}

/**
 * Source items eligible for the Daily Memo (newest first). Unlike
 * listRecentSourceItems, this enforces the per-source memo-inclusion contract:
 *  - WhatsApp items only qualify when their chat's monitor is active AND has
 *    include_in_daily_memo enabled — opt-in per chat (ADR-036).
 *  - GitHub items are dropped when their repository's monitor has
 *    include_in_daily_memo disabled — opt-out per repository (default on).
 * Systems without such a flag (notion, upload, …) are always eligible.
 */
export async function listMemoSourceItems(
  tenantId: string,
  limit = 25,
): Promise<StoredSourceItem[]> {
  const secret = createSupabaseSecretClient();

  const [chatMonitors, repoMonitors, channelScopes] = await Promise.all([
    secret
      .from("whatsapp_monitors")
      .select("chat_id")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .eq("include_in_daily_memo", true),
    secret
      .from("github_repository_monitors")
      .select("repository_full_name")
      .eq("tenant_id", tenantId)
      .eq("include_in_daily_memo", false),
    secret
      .from("source_scope_items")
      .select("id, system, include_in_daily_memo, priority")
      .eq("tenant_id", tenantId)
      .in("system", ["slack", "discord"])
      .eq("is_active", true),
  ]);
  if (chatMonitors.error) throw new Error(chatMonitors.error.message);
  if (repoMonitors.error) throw new Error(repoMonitors.error.message);
  if (channelScopes.error) throw new Error(channelScopes.error.message);

  const memoChatIds = new Set(
    (chatMonitors.data ?? []).map((m) => m.chat_id as string),
  );
  const mutedRepos = new Set(
    (repoMonitors.data ?? []).map((m) => m.repository_full_name as string),
  );
  const memoChannelScopeIds = new Set(
    (channelScopes.data ?? [])
      .filter((s) => s.include_in_daily_memo)
      .map((s) => s.id as string),
  );
  const highPriorityScopeIds = new Set(
    (channelScopes.data ?? [])
      .filter((s) => s.priority === "high")
      .map((s) => s.id as string),
  );

  // Over-fetch so items filtered out below don't underfill the memo pool. The
  // raw payload carries the only link from an item back to its monitor:
  // raw->chatId for WhatsApp (kept under every storage policy), raw->repository
  // ("owner/name") for GitHub.
  const { data, error } = await secret
    .from("source_items")
    .select("id, system, title, body, author, occurred_at, created_at, raw")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit * 4);
  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((r) => {
      const raw = r.raw as Record<string, unknown> | null;
      if ((r.system as string) === "whatsapp") {
        const chatId = raw?.chatId;
        return typeof chatId === "string" && memoChatIds.has(chatId);
      }
      if ((r.system as string) === "github") {
        const repository = raw?.repository;
        return !(typeof repository === "string" && mutedRepos.has(repository));
      }
      if ((r.system as string) === "slack" || (r.system as string) === "discord") {
        const scopeItemId = raw?.scopeItemId;
        return typeof scopeItemId === "string" && memoChannelScopeIds.has(scopeItemId);
      }
      return true;
    })
    .sort((a, b) => {
      const aScope = (a.raw as Record<string, unknown> | null)?.scopeItemId;
      const bScope = (b.raw as Record<string, unknown> | null)?.scopeItemId;
      const aPriority = typeof aScope === "string" && highPriorityScopeIds.has(aScope) ? 1 : 0;
      const bPriority = typeof bScope === "string" && highPriorityScopeIds.has(bScope) ? 1 : 0;
      if (aPriority !== bPriority) return bPriority - aPriority;
      return 0;
    })
    .slice(0, limit)
    .map(mapStoredItem);
}

/** Attach a summary to a source item. */
export async function insertSummary(
  tenantId: string,
  sourceItemId: string,
  summary: string,
): Promise<void> {
  const secret = createSupabaseSecretClient();
  const { error } = await secret.from("content_summaries").insert({
    tenant_id: tenantId,
    source_item_id: sourceItemId,
    summary,
  });
  if (error) throw new Error(error.message);
}
