import "server-only";

/**
 * modules/source-connection/source-scope.ts
 *
 * Generic per-source scope-item persistence (the `source_scope_items` table):
 * Gmail labels and Google calendars the operator can select. Same client split
 * as the other connectors — discovery/sync use the SECRET client with an
 * explicit tenant_id; operator reads/edits use the RLS USER client.
 *
 * Governance: architecture/source-integration-strategy.md §5/§8/§9.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import type {
  ScopeItemType,
  SourceScopeItem,
  SourceType,
} from "./source.types";

interface ScopeItemRow {
  id: string;
  system: string;
  item_type: string;
  external_id: string;
  name: string | null;
  is_active: boolean;
  include_in_daily_memo: boolean;
  priority: string;
  sync_cursor: string | null;
  metadata: Record<string, unknown> | null;
  last_sync_at: string | null;
}

const SELECT_COLUMNS =
  "id, system, item_type, external_id, name, is_active, include_in_daily_memo, priority, sync_cursor, metadata, last_sync_at";

function mapRow(row: ScopeItemRow): SourceScopeItem {
  return {
    id: row.id,
    system: row.system as SourceType,
    itemType: row.item_type as ScopeItemType,
    externalId: row.external_id,
    name: row.name,
    isActive: row.is_active,
    includeInDailyMemo: row.include_in_daily_memo,
    priority: row.priority === "high" ? "high" : "normal",
    syncCursor: row.sync_cursor,
    metadata: row.metadata,
    lastSyncAt: row.last_sync_at,
  };
}

/** A discovered scope item to persist (before the operator activates it). */
export interface DiscoveredScopeItem {
  externalId: string;
  itemType: ScopeItemType;
  name: string;
  metadata?: Record<string, unknown>;
}

/**
 * Persist discovered scope items as available (inactive) — SECRET client,
 * explicit tenant_id. Existing rows are left untouched (ignoreDuplicates) so
 * operator selections survive a re-discovery. Returns how many were added.
 */
export async function upsertScopeItems(
  tenantId: string,
  sourceConnectionId: string,
  system: SourceType,
  items: readonly DiscoveredScopeItem[],
): Promise<number> {
  if (items.length === 0) return 0;
  const secret = createSupabaseSecretClient();
  const rows = items.map((i) => ({
    tenant_id: tenantId,
    source_connection_id: sourceConnectionId,
    system,
    item_type: i.itemType,
    external_id: i.externalId,
    name: i.name,
    metadata: i.metadata ?? null,
  }));
  const { data, error } = await secret
    .from("source_scope_items")
    .upsert(rows, { onConflict: "source_connection_id,external_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** List a connection's scope items (RLS user client). */
export async function listScopeItems(
  sourceConnectionId: string,
): Promise<SourceScopeItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("source_scope_items")
    .select(SELECT_COLUMNS)
    .eq("source_connection_id", sourceConnectionId)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ScopeItemRow[]).map(mapRow);
}

/** List a connection's *active* scope items (SECRET client; for sync). */
export async function listActiveScopeItems(
  tenantId: string,
  sourceConnectionId: string,
): Promise<SourceScopeItem[]> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("source_scope_items")
    .select(SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("source_connection_id", sourceConnectionId)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return ((data ?? []) as ScopeItemRow[]).map(mapRow);
}

/** Activate/deactivate a scope item (RLS user client; tenant-enforced). */
export async function updateScopeItem(
  scopeItemId: string,
  input:
    | boolean
    | {
        isActive?: boolean;
        includeInDailyMemo?: boolean;
        priority?: "normal" | "high";
      },
): Promise<boolean> {
  const patch =
    typeof input === "boolean"
      ? { is_active: input }
      : {
          ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
          ...(input.includeInDailyMemo !== undefined
            ? { include_in_daily_memo: input.includeInDailyMemo }
            : {}),
          ...(input.priority ? { priority: input.priority } : {}),
        };
  if (Object.keys(patch).length === 0) return false;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("source_scope_items")
    .update(patch)
    .eq("id", scopeItemId)
    .select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

/** Stamp last_sync_at on a scope item (SECRET client; tenant-scoped). */
export async function markScopeItemSynced(
  tenantId: string,
  scopeItemId: string,
  when: string,
): Promise<void> {
  const secret = createSupabaseSecretClient();
  await secret
    .from("source_scope_items")
    .update({ last_sync_at: when })
    .eq("id", scopeItemId)
    .eq("tenant_id", tenantId);
}

/** Stamp last_sync_at and provider cursor on a scope item after incremental sync. */
export async function markScopeItemSyncState(
  tenantId: string,
  scopeItemId: string,
  input: { when: string; syncCursor?: string | null },
): Promise<void> {
  const secret = createSupabaseSecretClient();
  await secret
    .from("source_scope_items")
    .update({
      last_sync_at: input.when,
      ...(input.syncCursor !== undefined ? { sync_cursor: input.syncCursor } : {}),
    })
    .eq("id", scopeItemId)
    .eq("tenant_id", tenantId);
}
