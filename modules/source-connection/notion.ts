import "server-only";

/**
 * modules/source-connection/notion.ts
 *
 * Notion connector via an **internal integration token** (minimal-friction:
 * no OAuth app, no redirect URI). The operator shares specific pages/databases
 * with their integration; we discover only what was shared, the operator
 * activates which to sync, and ingestion pulls text **only** from active
 * resources — honouring the principle that scope is defined by what the operator
 * shares + approves, never the whole workspace.
 *
 * Client choice (mirrors github-repos.ts):
 *  - Token validation + discovery + sync run server-side (a server action that
 *    holds the token) and use the SECRET client with an explicit tenant_id.
 *  - Operator reads/edits of the selection use the RLS USER client.
 *
 * Governance: architecture/source-integration-strategy.md §12, services/source-connection.md.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { ingestProviderItems } from "@/modules/ingestion/server";
import type { ProviderRawItem } from "@/modules/ingestion";
import type { NotionResource, NotionObjectType } from "./source.types";

const API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const MAX_BLOCKS = 60;
const MAX_TEXT = 8000;

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
    "User-Agent": "pilot-app",
  };
}

async function notionGet<T>(token: string, path: string): Promise<T | null> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: headers(token),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/** Validate an integration token by calling /users/me. */
export async function validateNotionToken(token: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/users/me`, {
    headers: headers(token),
    cache: "no-store",
  });
  return res.ok;
}

// --- Discovery --------------------------------------------------------------

interface NotionRichText {
  plain_text?: string;
}
interface NotionSearchResult {
  object: "page" | "database";
  id: string;
  url?: string;
  title?: NotionRichText[]; // databases
  properties?: Record<string, { type?: string; title?: NotionRichText[] }>; // pages
}

function joinRichText(rt: NotionRichText[] | undefined): string {
  return (rt ?? []).map((t) => t.plain_text ?? "").join("").trim();
}

function resultTitle(result: NotionSearchResult): string {
  if (result.object === "database") {
    return joinRichText(result.title) || "Untitled database";
  }
  // page: find the title-typed property
  for (const value of Object.values(result.properties ?? {})) {
    if (value?.type === "title") {
      const t = joinRichText(value.title);
      if (t) return t;
    }
  }
  return "Untitled page";
}

export interface DiscoveredResource {
  notionId: string;
  objectType: NotionObjectType;
  title: string;
  url: string | null;
}

/**
 * Discover the pages/databases the integration can see (i.e. those the operator
 * shared with it). Bounded to 100 results. Scope is what was shared — we never
 * see the whole workspace.
 */
export async function discoverNotionResources(
  token: string,
): Promise<DiscoveredResource[]> {
  const res = await fetch(`${API_BASE}/search`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ page_size: 100 }),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: NotionSearchResult[] };
  return (data.results ?? []).map((r) => ({
    notionId: r.id,
    objectType: r.object,
    title: resultTitle(r),
    url: r.url ?? null,
  }));
}

// --- Persistence ------------------------------------------------------------

interface NotionResourceRow {
  id: string;
  notion_id: string;
  object_type: string;
  title: string | null;
  url: string | null;
  is_active: boolean;
  last_sync_at: string | null;
}

const SELECT_COLUMNS = "id, notion_id, object_type, title, url, is_active, last_sync_at";

function mapRow(row: NotionResourceRow): NotionResource {
  return {
    id: row.id,
    notionId: row.notion_id,
    objectType: (row.object_type as NotionObjectType) ?? "page",
    title: row.title,
    url: row.url,
    isActive: row.is_active,
    lastSyncAt: row.last_sync_at,
  };
}

/**
 * Persist discovered resources as available (inactive) monitors (SECRET client,
 * explicit tenant_id). Existing rows are left untouched so operator selections
 * survive a re-discovery. Returns how many were added.
 */
export async function upsertAvailableResources(
  tenantId: string,
  sourceConnectionId: string,
  resources: readonly DiscoveredResource[],
): Promise<number> {
  if (resources.length === 0) return 0;
  const secret = createSupabaseSecretClient();
  const rows = resources.map((r) => ({
    tenant_id: tenantId,
    source_connection_id: sourceConnectionId,
    notion_id: r.notionId,
    object_type: r.objectType,
    title: r.title,
    url: r.url,
  }));
  const { data, error } = await secret
    .from("notion_resources")
    .upsert(rows, { onConflict: "source_connection_id,notion_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** List the operator's Notion resources for a connection (RLS user client). */
export async function listNotionResources(
  sourceConnectionId: string,
): Promise<NotionResource[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("notion_resources")
    .select(SELECT_COLUMNS)
    .eq("source_connection_id", sourceConnectionId)
    .order("title", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as NotionResourceRow[]).map(mapRow);
}

/** Activate/deactivate a Notion resource (RLS user client; tenant-enforced). */
export async function updateNotionResource(
  resourceId: string,
  isActive: boolean,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("notion_resources")
    .update({ is_active: isActive })
    .eq("id", resourceId)
    .select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

// --- Content fetch + sync ---------------------------------------------------

interface NotionBlock {
  type: string;
  [key: string]: unknown;
}

/** Extract plain text from a page's block children (bounded). */
async function fetchPageText(token: string, pageId: string): Promise<string> {
  const data = await notionGet<{ results?: NotionBlock[] }>(
    token,
    `/blocks/${encodeURIComponent(pageId)}/children?page_size=${MAX_BLOCKS}`,
  );
  const parts: string[] = [];
  for (const block of data?.results ?? []) {
    const payload = block[block.type] as { rich_text?: NotionRichText[] } | undefined;
    const text = joinRichText(payload?.rich_text);
    if (text) parts.push(text);
    if (parts.join("\n").length >= MAX_TEXT) break;
  }
  return parts.join("\n").slice(0, MAX_TEXT);
}

/** Outcome of a Notion sync run. */
export interface NotionSyncResult {
  resourceCount: number;
  itemCount: number;
}

/**
 * Sync the operator's **active** Notion resources only. For pages we ingest the
 * extracted block text; for databases we ingest a metadata item (deep row
 * querying is a documented follow-up). Uses the SECRET client + explicit
 * tenant_id (it needs the stored token and runs tenant-scoped).
 */
export async function syncActiveResources(
  tenantId: string,
  sourceConnectionId: string,
  token: string,
): Promise<NotionSyncResult> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("notion_resources")
    .select(SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("source_connection_id", sourceConnectionId)
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  const active = ((data ?? []) as NotionResourceRow[]).map(mapRow);
  let itemCount = 0;
  const now = new Date().toISOString();

  for (const resource of active) {
    let body: string;
    if (resource.objectType === "page") {
      body = await fetchPageText(token, resource.notionId);
    } else {
      body = `Notion database: ${resource.title ?? "Untitled"}${resource.url ? ` (${resource.url})` : ""}`;
    }
    if (body.trim().length === 0) {
      body = resource.title ?? "Untitled";
    }

    const item: ProviderRawItem = {
      externalId: `notion:${resource.notionId}`,
      title: resource.title ?? "Untitled",
      body,
      author: null,
      occurredAt: now,
      kind: resource.objectType,
      raw: {
        source: "notion",
        notionId: resource.notionId,
        objectType: resource.objectType,
        url: resource.url,
      },
    };
    const result = await ingestProviderItems(tenantId, sourceConnectionId, "notion", [item]);
    itemCount += result.itemCount;

    await secret
      .from("notion_resources")
      .update({ last_sync_at: now })
      .eq("id", resource.id)
      .eq("tenant_id", tenantId);
  }

  return { resourceCount: active.length, itemCount };
}
