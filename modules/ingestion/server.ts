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

/**
 * Ingest a batch of provider items for a tenant (used by OAuth callbacks that
 * run without a user session). Tenant-scoped via the knowledge-store secret
 * path. Returns a summary; never throws on an individual bad item.
 */
export async function ingestProviderItems(
  tenantId: string,
  sourceConnectionId: string,
  system: SourceSystem,
  items: readonly ProviderRawItem[],
): Promise<IngestionResult> {
  let itemCount = 0;
  for (const item of items) {
    if (!item.body || item.body.trim().length === 0) continue;
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
    itemCount += 1;
  }
  return { sourceConnectionId, system, itemCount };
}
