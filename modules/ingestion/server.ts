import "server-only";

/**
 * modules/ingestion/server.ts
 *
 * Request-time ingestion paths. Each path: ensure/locate a source connection,
 * normalise the payload (modules/normalisation), then persist a canonical
 * source_item via the knowledge-store (secret client, tenant-scoped).
 * Governance: services/ingestion.md, normalisation.md.
 */

import type { SourceSystem, TenantContext } from "@/modules/shared";
import { normaliseContent } from "@/modules/normalisation";
import { parseObsidianMarkdown } from "@/modules/normalisation/obsidian";
import { insertSourceItem } from "@/modules/knowledge-store/server";
import { auditService } from "@/modules/audit";
import { ensureSourceConnection } from "@/modules/source-connection/server";
import type { IngestionResult, ProviderRawItem } from "./index";

/** Max body length we persist for a manual upload (defence against huge pastes). */
const MAX_UPLOAD_BODY = 100_000;

/**
 * Ingest operator-pasted text or an uploaded text file as a `file_upload`
 * source item. Runs with a real user session, so the connection is ensured via
 * the RLS client. Returns the new item id.
 */
export async function ingestPastedText(
  ctx: TenantContext,
  input: { title?: string | null; body: string },
): Promise<{ itemId: string }> {
  const trimmed = input.body.slice(0, MAX_UPLOAD_BODY);
  const connectionId = await ensureSourceConnection(ctx, "file_upload");

  const normalised = normaliseContent({
    system: "file_upload",
    title: input.title,
    body: trimmed,
    kind: "note",
  });

  const itemId = await insertSourceItem(ctx.tenantId, {
    sourceConnectionId: connectionId,
    system: "file_upload",
    kind: normalised.kind,
    title: normalised.title,
    body: normalised.body,
    author: ctx.userId,
    occurredAt: new Date().toISOString(),
    raw: { source: "manual_upload" },
  });

  await auditService.record(ctx, {
    action: "source_item.ingested",
    target: itemId,
    metadata: { system: "file_upload", title: normalised.title },
  });

  return { itemId };
}

/** A single uploaded Obsidian note (filename + raw markdown). */
export interface ObsidianUpload {
  readonly filename: string;
  readonly content: string;
}

/**
 * Ingest uploaded Obsidian vault notes as `obsidian` source items. Runs with a
 * real user session (RLS client) — the operator explicitly uploaded these, so
 * nothing is read from disk. Each note is parsed (frontmatter, tags, internal
 * wikilinks) and stored with that structure in `raw` for traceability. Returns
 * the number of notes ingested. Governance: source-integration-strategy.md §13.
 */
export async function ingestObsidianNotes(
  ctx: TenantContext,
  notes: readonly ObsidianUpload[],
): Promise<{ itemCount: number }> {
  if (notes.length === 0) return { itemCount: 0 };
  const connectionId = await ensureSourceConnection(ctx, "obsidian");

  let itemCount = 0;
  for (const note of notes) {
    const parsed = parseObsidianMarkdown(note.filename, note.content.slice(0, MAX_UPLOAD_BODY));
    if (parsed.body.trim().length === 0 && parsed.title.length === 0) continue;

    const normalised = normaliseContent({
      system: "obsidian",
      title: parsed.title,
      body: parsed.body,
      kind: "note",
    });

    await insertSourceItem(ctx.tenantId, {
      sourceConnectionId: connectionId,
      system: "obsidian",
      externalId: `obsidian:${note.filename}`,
      kind: normalised.kind,
      title: normalised.title,
      body: normalised.body,
      author: ctx.userId,
      occurredAt: parsed.occurredAt ?? new Date().toISOString(),
      raw: {
        source: "obsidian_upload",
        filename: note.filename,
        tags: parsed.tags,
        links: parsed.links,
        frontmatter: parsed.frontmatter,
      },
    });
    itemCount += 1;
  }

  await auditService.record(ctx, {
    action: "source_item.ingested",
    target: connectionId,
    metadata: { system: "obsidian", noteCount: itemCount },
  });

  return { itemCount };
}

/** A provider item is worth persisting only if it carries non-empty body text. */
export function hasIngestableBody(item: ProviderRawItem): boolean {
  return Boolean(item.body && item.body.trim().length > 0);
}

/**
 * Persist one provider item as a canonical source_item. Extracted so the
 * per-item work is a single awaited unit that {@link ingestProviderItems} can
 * guard — a throw here (malformed payload, transient DB error) must not abort
 * the rest of the batch.
 */
async function persistProviderItem(
  tenantId: string,
  sourceConnectionId: string,
  system: SourceSystem,
  item: ProviderRawItem,
): Promise<void> {
  const normalised = normaliseContent({
    system,
    title: item.title,
    body: item.body,
    kind: item.kind,
  });
  await insertSourceItem(tenantId, {
    sourceConnectionId,
    system,
    externalId: item.externalId ?? null,
    kind: normalised.kind,
    title: normalised.title,
    body: normalised.body,
    author: item.author ?? null,
    occurredAt: item.occurredAt ?? null,
    raw: item.raw ?? null,
  });
}

/**
 * Ingest a batch of provider items for a tenant (used by OAuth callbacks and
 * scheduled syncs that run without a user session). Tenant-scoped via the
 * knowledge-store secret path.
 *
 * Best-effort per item: a single malformed item or a transient failure
 * persisting one row is logged and counted (`failedCount`) but does NOT abort
 * the batch, so one bad message can't sink an entire provider sync (and the
 * callers' post-sync bookkeeping — e.g. `last_sync_at` cursors). Empty-body
 * items are silently skipped and not counted as failures.
 */
export async function ingestProviderItems(
  tenantId: string,
  sourceConnectionId: string,
  system: SourceSystem,
  items: readonly ProviderRawItem[],
): Promise<IngestionResult> {
  let itemCount = 0;
  let failedCount = 0;
  for (const item of items) {
    if (!hasIngestableBody(item)) continue;
    try {
      await persistProviderItem(tenantId, sourceConnectionId, system, item);
      itemCount += 1;
    } catch (error) {
      failedCount += 1;
      console.error("[ingestion] failed to persist provider item", {
        system,
        sourceConnectionId,
        externalId: item.externalId ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { sourceConnectionId, system, itemCount, failedCount };
}
