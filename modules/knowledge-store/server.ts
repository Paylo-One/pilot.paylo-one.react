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
  return (data ?? []).map((r) => ({
    id: r.id as string,
    system: r.system as string,
    title: (r.title as string | null) ?? null,
    body: (r.body as string | null) ?? null,
    author: (r.author as string | null) ?? null,
    occurredAt: (r.occurred_at as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
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
