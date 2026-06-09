"use server";

/**
 * Sources server actions. Mutations re-derive the trusted tenant context
 * server-side (never from client input) and delegate to the ingestion module.
 */

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import {
  ingestPastedText,
  ingestObsidianNotes,
  type ObsidianUpload,
} from "@/modules/ingestion/server";
import {
  disconnectSourceConnection,
  findConnectionIdBySystem,
  getIntegrationAccessToken,
  upsertProviderConnection,
  storeIntegrationCredentials,
} from "@/modules/source-connection/server";
import {
  updateRepositoryMonitor,
  syncActiveRepositories,
} from "@/modules/source-connection/github-repos";
import {
  validateNotionToken,
  discoverNotionResources,
  upsertAvailableResources,
  updateNotionResource,
  syncActiveResources as syncActiveNotionResources,
} from "@/modules/source-connection/notion";
import type { GitHubMonitorSettings } from "@/modules/source-connection/source.types";
import { auditService } from "@/modules/audit";

/** Disconnect a source connection and clear its OAuth credentials. */
export async function disconnectConnectionAction(
  _prev: { error: string | null } | null,
  formData: FormData,
): Promise<{ error: string | null }> {
  const ctx = await requireTenantContext();
  const connectionId = formData.get("connectionId");
  if (typeof connectionId !== "string" || !connectionId) {
    return { error: "Missing connection ID." };
  }
  try {
    await disconnectSourceConnection(connectionId, ctx.tenantId);
    revalidatePath("/sources");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Disconnect failed." };
  }
}

/**
 * Activate/deactivate a repository or change its per-repo monitoring signals.
 * Re-derives tenant context; the actual update runs through the RLS client so
 * a tenant can only ever change a monitor row it owns (ADR-024/025/026).
 */
export async function updateRepoMonitorAction(input: {
  monitorId: string;
  isActive?: boolean;
  monitors?: Partial<GitHubMonitorSettings>;
}): Promise<{ ok: boolean; error: string | null }> {
  const ctx = await requireTenantContext();
  if (!input?.monitorId) return { ok: false, error: "Missing repository." };
  try {
    const changed = await updateRepositoryMonitor(input.monitorId, {
      isActive: input.isActive,
      monitors: input.monitors,
    });
    if (changed) {
      await auditService.record(ctx, {
        action: "github.repository_monitor.updated",
        target: input.monitorId,
        metadata: {
          isActive: input.isActive,
          monitors: input.monitors ?? null,
        },
      });
    }
    revalidatePath("/sources");
    return { ok: changed, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Update failed." };
  }
}

/**
 * Sync activity from the operator's *active* GitHub repositories only. Reads the
 * tenant's github connection + stored token server-side (never from the client)
 * and ingests per-repo, honouring each repository's signal toggles.
 */
export async function syncGithubRepositoriesAction(): Promise<{
  ok: boolean;
  itemCount?: number;
  repositoryCount?: number;
  error: string | null;
}> {
  const ctx = await requireTenantContext();
  try {
    const connectionId = await findConnectionIdBySystem("github");
    if (!connectionId) return { ok: false, error: "GitHub is not connected." };

    const token = await getIntegrationAccessToken(ctx.tenantId, connectionId);
    if (!token) return { ok: false, error: "No GitHub credentials stored." };

    const result = await syncActiveRepositories(ctx.tenantId, connectionId, token);
    await auditService.record(ctx, {
      action: "github.repositories.synced",
      target: connectionId,
      metadata: {
        repositoryCount: result.repositoryCount,
        itemCount: result.itemCount,
      },
    });
    revalidatePath("/sources");
    return {
      ok: true,
      itemCount: result.itemCount,
      repositoryCount: result.repositoryCount,
      error: null,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sync failed." };
  }
}

// --- Notion -----------------------------------------------------------------

/**
 * Connect Notion with an internal-integration token. Validates the token, stores
 * it tenant-scoped (secret client), creates/updates the connection, then
 * discovers the pages/databases the operator shared with the integration —
 * stored as available (inactive). Nothing is ingested until a resource is
 * activated (ADR-025/026). The token is never echoed back to the client.
 */
export async function connectNotionAction(input: {
  token: string;
}): Promise<{ ok: boolean; discovered?: number; error: string | null }> {
  const ctx = await requireTenantContext();
  const token = input?.token?.trim();
  if (!token) return { ok: false, error: "Paste your Notion integration token." };

  try {
    const valid = await validateNotionToken(token);
    if (!valid) {
      return { ok: false, error: "Notion rejected that token. Check it and try again." };
    }

    const connectionId = await upsertProviderConnection(ctx.tenantId, "notion", {
      displayName: "Notion",
      status: "connected",
    });
    await storeIntegrationCredentials(ctx.tenantId, connectionId, { accessToken: token });

    const resources = await discoverNotionResources(token);
    const added = await upsertAvailableResources(ctx.tenantId, connectionId, resources);

    await auditService.record(ctx, {
      action: "source_connection.notion.connected",
      target: connectionId,
      metadata: { discovered: resources.length, added },
    });
    revalidatePath("/sources");
    return { ok: true, discovered: resources.length, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Connection failed." };
  }
}

/** Activate/deactivate a shared Notion page or database. */
export async function updateNotionResourceAction(input: {
  resourceId: string;
  isActive: boolean;
}): Promise<{ ok: boolean; error: string | null }> {
  const ctx = await requireTenantContext();
  if (!input?.resourceId) return { ok: false, error: "Missing resource." };
  try {
    const changed = await updateNotionResource(input.resourceId, input.isActive);
    if (changed) {
      await auditService.record(ctx, {
        action: "notion.resource.updated",
        target: input.resourceId,
        metadata: { isActive: input.isActive },
      });
    }
    revalidatePath("/sources");
    return { ok: changed, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Update failed." };
  }
}

/** Sync text from the operator's active Notion resources only. */
export async function syncNotionAction(): Promise<{
  ok: boolean;
  itemCount?: number;
  resourceCount?: number;
  error: string | null;
}> {
  const ctx = await requireTenantContext();
  try {
    const connectionId = await findConnectionIdBySystem("notion");
    if (!connectionId) return { ok: false, error: "Notion is not connected." };
    const token = await getIntegrationAccessToken(ctx.tenantId, connectionId);
    if (!token) return { ok: false, error: "No Notion credentials stored." };

    const result = await syncActiveNotionResources(ctx.tenantId, connectionId, token);
    await auditService.record(ctx, {
      action: "notion.resources.synced",
      target: connectionId,
      metadata: { resourceCount: result.resourceCount, itemCount: result.itemCount },
    });
    revalidatePath("/sources");
    return {
      ok: true,
      itemCount: result.itemCount,
      resourceCount: result.resourceCount,
      error: null,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sync failed." };
  }
}

export interface UploadResult {
  readonly ok: boolean;
  readonly message: string;
}

const ALLOWED_FILE = /\.(txt|md|markdown|text)$/i;

/**
 * Ingest a pasted note or an uploaded .txt/.md file as a file_upload source
 * item. Used with `useActionState` from the upload form.
 */
export async function uploadNoteAction(
  _prev: UploadResult | null,
  formData: FormData,
): Promise<UploadResult> {
  const ctx = await requireTenantContext();

  const title = (formData.get("title") as string | null)?.trim() || null;
  let body = (formData.get("body") as string | null)?.trim() ?? "";

  const file = formData.get("file");
  if (body.length === 0 && file instanceof File && file.size > 0) {
    if (!ALLOWED_FILE.test(file.name)) {
      return { ok: false, message: "Only .txt or .md files are supported." };
    }
    if (file.size > 1_000_000) {
      return { ok: false, message: "File is too large (1 MB maximum)." };
    }
    body = (await file.text()).trim();
  }

  if (body.length === 0) {
    return { ok: false, message: "Paste some text or attach a .txt/.md file." };
  }

  try {
    await ingestPastedText(ctx, { title, body });
    revalidatePath("/sources");
    return { ok: true, message: "Saved to your workspace." };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Upload failed.",
    };
  }
}

const OBSIDIAN_FILE = /\.(md|markdown|mdx|txt)$/i;
const MAX_OBSIDIAN_FILES = 50;
const MAX_OBSIDIAN_FILE_BYTES = 1_000_000;

/**
 * Ingest uploaded Obsidian vault notes (.md/.markdown). The operator selects the
 * files — local-first, no disk crawl (ADR-028). Each note is parsed (frontmatter,
 * tags, internal wikilinks) and stored as an `obsidian` source item. Used with
 * `useActionState` from the Obsidian upload form.
 */
export async function uploadObsidianAction(
  _prev: UploadResult | null,
  formData: FormData,
): Promise<UploadResult> {
  const ctx = await requireTenantContext();

  const entries = formData.getAll("files");
  const notes: ObsidianUpload[] = [];
  let skipped = 0;

  for (const entry of entries) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    if (!OBSIDIAN_FILE.test(entry.name)) {
      skipped += 1;
      continue;
    }
    if (entry.size > MAX_OBSIDIAN_FILE_BYTES) {
      skipped += 1;
      continue;
    }
    if (notes.length >= MAX_OBSIDIAN_FILES) break;
    notes.push({ filename: entry.name, content: await entry.text() });
  }

  if (notes.length === 0) {
    return {
      ok: false,
      message: "Select one or more Markdown (.md) notes from your vault.",
    };
  }

  try {
    const { itemCount } = await ingestObsidianNotes(ctx, notes);
    revalidatePath("/sources");
    const skippedNote = skipped > 0 ? ` (${skipped} non-Markdown file${skipped === 1 ? "" : "s"} skipped)` : "";
    return {
      ok: true,
      message: `Imported ${itemCount} note${itemCount === 1 ? "" : "s"} from your vault${skippedNote}.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Import failed.",
    };
  }
}
