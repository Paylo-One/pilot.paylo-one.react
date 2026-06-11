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
import { updateScopeItem } from "@/modules/source-connection/source-scope";
import {
  getWhatsAppSession,
  setSessionStatus,
  deleteSession,
  deleteSessionMaterial,
  listActiveMonitorChatIds,
  createMonitor as createWhatsAppMonitor,
  updateMonitor as updateWhatsAppMonitor,
  removeMonitor as removeWhatsAppMonitor,
} from "@/modules/source-connection/whatsapp-server";
import {
  bridgeStartSession,
  bridgeGetSession,
  bridgeListChats,
  bridgeSetMonitors,
  bridgeBackfillChat,
  bridgeDisconnect,
  type BridgeSessionState,
} from "@/modules/source-connection/whatsapp-bridge-client";
import {
  MOCK_WHATSAPP_CHATS,
  type WhatsAppChat,
  type WhatsAppSessionStatus,
  type WhatsAppStoragePolicy,
} from "@/modules/source-connection/whatsapp.types";
import { whatsappBridgeEnabled } from "@/lib/config";
import {
  getValidGoogleToken,
  syncGmail,
  syncCalendar,
} from "@/modules/source-connection/google";
import type {
  GitHubMonitorSettings,
  SourceType,
} from "@/modules/source-connection/source.types";
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

// --- Google (Gmail + Calendar) ----------------------------------------------

/** Activate/deactivate a Gmail label or Google calendar (scope item). */
export async function updateScopeItemAction(input: {
  scopeItemId: string;
  isActive: boolean;
}): Promise<{ ok: boolean; error: string | null }> {
  const ctx = await requireTenantContext();
  if (!input?.scopeItemId) return { ok: false, error: "Missing scope item." };
  try {
    const changed = await updateScopeItem(input.scopeItemId, input.isActive);
    if (changed) {
      await auditService.record(ctx, {
        action: "source.scope_item.updated",
        target: input.scopeItemId,
        metadata: { isActive: input.isActive },
      });
    }
    revalidatePath("/sources");
    return { ok: changed, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Update failed." };
  }
}

/**
 * Sync the Google family for one system (`email` = Gmail, `calendar` = Google
 * Calendar) from its *active* scope items only. Reads the connection + token
 * server-side (refreshing if expired) — never from the client.
 */
export async function syncGoogleAction(input: {
  system: SourceType;
}): Promise<{ ok: boolean; itemCount?: number; scopeCount?: number; error: string | null }> {
  const ctx = await requireTenantContext();
  const system = input?.system;
  if (system !== "email" && system !== "calendar") {
    return { ok: false, error: "Unsupported Google source." };
  }
  try {
    const connectionId = await findConnectionIdBySystem(system);
    if (!connectionId) return { ok: false, error: "Google is not connected." };
    const token = await getValidGoogleToken(ctx.tenantId, connectionId);
    if (!token) return { ok: false, error: "No Google credentials stored." };

    const result =
      system === "email"
        ? await syncGmail(ctx.tenantId, connectionId, token)
        : await syncCalendar(ctx.tenantId, connectionId, token);

    await auditService.record(ctx, {
      action: "google.synced",
      target: connectionId,
      metadata: { system, itemCount: result.itemCount, scopeCount: result.scopeCount },
    });
    revalidatePath("/sources");
    return { ok: true, itemCount: result.itemCount, scopeCount: result.scopeCount, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sync failed." };
  }
}

// --- WhatsApp (tenant-scoped session + monitors; real bridge behind a flag) --
//
// When WHATSAPP_BRIDGE_ENABLED is on, the lifecycle is driven by the real
// Web-session bridge (ADR-036). When off, the persisted scaffold path is used
// (simulated scan, mock discovery) so the UX stays explorable without a bridge.

type WaResult = { ok: boolean; error: string | null };

/**
 * Push the active-monitor chat allowlist to the bridge so it forwards messages
 * from approved chats only — enforcement at the bridge boundary, not just the
 * UI. No-op when the bridge is disabled. Best-effort: failures don't block the
 * operator's selection (which is already persisted and authoritative).
 */
async function syncBridgeMonitors(tenantId: string, sessionId: string): Promise<void> {
  if (!whatsappBridgeEnabled()) return;
  try {
    const chatIds = await listActiveMonitorChatIds(sessionId);
    await bridgeSetMonitors(tenantId, chatIds);
  } catch {
    // Allowlist sync is best-effort; the persisted monitors remain the source
    // of truth and the ingestion webhook re-checks every message anyway.
  }
}

/**
 * Live bridge state, resuming a dropped session when needed: if the bridge
 * reports `disconnected` (e.g. it restarted and lost its in-memory session) but
 * our persisted session says it should be live, ask the bridge to start — it
 * resumes from the encrypted material without a re-scan. Keeps the operator
 * from facing a dead "connected" card after a bridge deploy/restart.
 */
async function ensureBridgeSession(tenantId: string): Promise<BridgeSessionState> {
  const state = await bridgeGetSession(tenantId);
  if (state.status !== "disconnected") return state;
  const session = await getWhatsAppSession();
  if (
    session &&
    (session.status === "connected" ||
      session.status === "connecting" ||
      session.status === "needs_reconnect")
  ) {
    return bridgeStartSession(tenantId);
  }
  return state;
}

/** Start the tenant's WhatsApp session (→ awaiting QR). */
export async function startWhatsAppSessionAction(): Promise<WaResult> {
  const ctx = await requireTenantContext();
  try {
    if (whatsappBridgeEnabled()) {
      // Create the session row BEFORE the bridge connects, so the bridge's
      // material-persistence callback always has a session to attach to (no race).
      await setSessionStatus(ctx.tenantId, "connecting", { qrCodeStatus: "pending" });
      const state = await bridgeStartSession(ctx.tenantId);
      await setSessionStatus(ctx.tenantId, state.status, {
        qrCodeStatus: state.qr ? "pending" : "none",
        deviceLabel: state.deviceLabel,
        lastConnectedAt: state.lastConnectedAt,
      });
    } else {
      await setSessionStatus(ctx.tenantId, "awaiting_qr", { qrCodeStatus: "pending" });
    }
    await auditService.record(ctx, {
      action: "whatsapp.session.started",
      metadata: { bridge: whatsappBridgeEnabled() },
    });
    revalidatePath("/sources");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to start session." };
  }
}

/**
 * Poll the live session while onboarding: returns the short-lived QR to render
 * and the current status, persisting status transitions (e.g. → connected) so a
 * page refresh reflects the linked device. QR is returned transiently and never
 * persisted. Bridge-only; returns disconnected when the bridge is off.
 */
export async function getWhatsAppSessionStatusAction(): Promise<{
  ok: boolean;
  status: WhatsAppSessionStatus;
  qr: string | null;
  error: string | null;
}> {
  const ctx = await requireTenantContext();
  if (!whatsappBridgeEnabled()) {
    return { ok: true, status: "disconnected", qr: null, error: null };
  }
  try {
    const state = await ensureBridgeSession(ctx.tenantId);
    await setSessionStatus(ctx.tenantId, state.status, {
      qrCodeStatus: state.qr ? "pending" : state.status === "connected" ? "scanned" : "none",
      deviceLabel: state.deviceLabel,
      lastConnectedAt: state.lastConnectedAt,
    });
    if (state.status === "connected") {
      // Make sure the bridge has the current allowlist after a (re)connect.
      const session = await getWhatsAppSession();
      if (session) await syncBridgeMonitors(ctx.tenantId, session.id);
    }
    return { ok: true, status: state.status, qr: state.qr, error: null };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      qr: null,
      error: err instanceof Error ? err.message : "Status check failed.",
    };
  }
}

/**
 * Discover one page of chats/contacts for the live session. The query searches
 * the bridge's FULL index (not just the loaded page); `total` drives the
 * "Load more" affordance. Returns the scaffold mock chats when the bridge is
 * disabled, paged the same way so both modes behave identically.
 */
export async function getWhatsAppChatsAction(
  query?: string,
  offset = 0,
  limit = 60,
): Promise<{ ok: boolean; chats: WhatsAppChat[]; total: number; error: string | null }> {
  const ctx = await requireTenantContext();
  if (!whatsappBridgeEnabled()) {
    const q = query?.trim().toLowerCase() ?? "";
    const matches = MOCK_WHATSAPP_CHATS.filter(
      (c) => q === "" || c.name.toLowerCase().includes(q),
    );
    return {
      ok: true,
      chats: matches.slice(offset, offset + limit),
      total: matches.length,
      error: null,
    };
  }
  try {
    // Resume the bridge session first if it was dropped (restart/redeploy) —
    // otherwise discovery would silently return an empty list.
    await ensureBridgeSession(ctx.tenantId);
    const page = await bridgeListChats(ctx.tenantId, query, offset, limit);
    return {
      ok: true,
      chats: page.chats.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        participantCount: c.participantCount,
        providerId: c.id,
      })),
      total: page.total,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      chats: [],
      total: 0,
      error: err instanceof Error ? err.message : "Discovery failed.",
    };
  }
}

/**
 * Scaffold-only: simulate a successful QR scan so the connected UX can be
 * explored. NO real WhatsApp session or credentials are established.
 */
export async function simulateWhatsAppScanAction(): Promise<WaResult> {
  const ctx = await requireTenantContext();
  try {
    await setSessionStatus(ctx.tenantId, "connected", {
      qrCodeStatus: "scanned",
      deviceLabel: "this workspace (scaffold)",
      lastConnectedAt: new Date().toISOString(),
    });
    await auditService.record(ctx, { action: "whatsapp.session.simulated_scan" });
    revalidatePath("/sources");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed." };
  }
}

/** Pause the session (stop ingestion, keep selections). */
export async function pauseWhatsAppAction(): Promise<WaResult> {
  const ctx = await requireTenantContext();
  try {
    // Stop forwarding immediately by clearing the bridge allowlist; the live
    // session + material are kept so the operator can resume without re-scanning.
    if (whatsappBridgeEnabled()) {
      try {
        await bridgeSetMonitors(ctx.tenantId, []);
      } catch {
        // best-effort; status below still reflects the paused intent
      }
    }
    await setSessionStatus(ctx.tenantId, "needs_reconnect");
    await auditService.record(ctx, { action: "whatsapp.session.paused" });
    revalidatePath("/sources");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed." };
  }
}

/** Disconnect & delete the session: revoke the linked device, wipe material. */
export async function disconnectWhatsAppAction(): Promise<WaResult> {
  const ctx = await requireTenantContext();
  try {
    if (whatsappBridgeEnabled()) {
      // Revoke the linked device + wipe in-bridge state first, so a failure here
      // surfaces rather than leaving an orphaned live session behind.
      await bridgeDisconnect(ctx.tenantId);
    }
    await deleteSessionMaterial(ctx.tenantId);
    await deleteSession(ctx.tenantId); // cascades monitors/contacts/chats
    await auditService.record(ctx, {
      action: "whatsapp.session.disconnected",
      metadata: { bridge: whatsappBridgeEnabled() },
    });
    revalidatePath("/sources");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed." };
  }
}

/** Approve a chat for monitoring (active by default). */
export async function approveWhatsAppChatAction(input: {
  chatId: string;
  chatName: string;
  chatKind: "direct" | "group";
}): Promise<WaResult> {
  const ctx = await requireTenantContext();
  try {
    const session = await getWhatsAppSession();
    if (!session) return { ok: false, error: "Start a WhatsApp session first." };
    await createWhatsAppMonitor(ctx.tenantId, session.id, input);
    await syncBridgeMonitors(ctx.tenantId, session.id);
    // Pull the chat's recent history now that it is approved — replayed buffer +
    // on-demand fetch, all through the deduplicated ingestion webhook. Best-
    // effort: live forwarding works regardless.
    let backfill: { replayed: number; requestedHistory: boolean } | null = null;
    if (whatsappBridgeEnabled()) {
      try {
        backfill = await bridgeBackfillChat(ctx.tenantId, input.chatId);
      } catch {
        // Backfill is opportunistic; the monitor itself is already persisted.
      }
    }
    await auditService.record(ctx, {
      action: "whatsapp.monitor.approved",
      metadata: {
        chatId: input.chatId,
        backfillReplayed: backfill?.replayed ?? 0,
        backfillRequestedHistory: backfill?.requestedHistory ?? false,
      },
    });
    revalidatePath("/sources");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to approve chat." };
  }
}

/** Toggle a monitor's activation / Daily Memo inclusion / storage policy. */
export async function updateWhatsAppMonitorAction(input: {
  monitorId: string;
  isActive?: boolean;
  includeInDailyMemo?: boolean;
  storagePolicy?: WhatsAppStoragePolicy;
}): Promise<WaResult> {
  const ctx = await requireTenantContext();
  if (!input?.monitorId) return { ok: false, error: "Missing monitor." };
  try {
    await updateWhatsAppMonitor(input.monitorId, {
      isActive: input.isActive,
      includeInDailyMemo: input.includeInDailyMemo,
      storagePolicy: input.storagePolicy,
    });
    // Activation/deactivation changes the forwarding allowlist.
    if (input.isActive !== undefined) {
      const session = await getWhatsAppSession();
      if (session) await syncBridgeMonitors(ctx.tenantId, session.id);
    }
    await auditService.record(ctx, {
      action: "whatsapp.monitor.updated",
      target: input.monitorId,
      metadata: { isActive: input.isActive, includeInDailyMemo: input.includeInDailyMemo },
    });
    revalidatePath("/sources");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Update failed." };
  }
}

/** Stop monitoring a chat. */
export async function removeWhatsAppMonitorAction(input: { monitorId: string }): Promise<WaResult> {
  const ctx = await requireTenantContext();
  if (!input?.monitorId) return { ok: false, error: "Missing monitor." };
  try {
    await removeWhatsAppMonitor(input.monitorId);
    const session = await getWhatsAppSession();
    if (session) await syncBridgeMonitors(ctx.tenantId, session.id);
    await auditService.record(ctx, { action: "whatsapp.monitor.removed", target: input.monitorId });
    revalidatePath("/sources");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Remove failed." };
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
