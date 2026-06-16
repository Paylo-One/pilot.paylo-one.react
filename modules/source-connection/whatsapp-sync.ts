import "server-only";

/**
 * modules/source-connection/whatsapp-sync.ts
 *
 * Scheduled WhatsApp sync (ADR-043). Unlike OAuth sources that pull on a poll,
 * WhatsApp is push-based: the bridge forwards messages to the ingestion webhook
 * (whatsapp-ingest.ts). The scheduled sync therefore (1) verifies the live
 * session is authenticated, (2) re-asserts the approved-chat allowlist at the
 * bridge boundary, and (3) asks the bridge to BACKFILL each approved chat — the
 * bridge then replays buffered/recent messages and requests older history,
 * delivering everything through the normal webhook (deduped on provider id).
 *
 * Runs in a job context (no operator session): reads use the secret client.
 *
 * Status semantics (so the operator can tell working / failing / waiting-for-auth):
 *  - bridge disabled (scaffold)         → success, 0 items (nothing to do)
 *  - bridge enabled, no/!connected session → THROWS a clear message → the run
 *    records last_sync_status='failed' + that reason; the WhatsApp session card
 *    independently shows the live auth state (awaiting QR / needs reconnect).
 *  - connected + approved chats         → backfill each, return replayed count.
 *
 * Governance: services/whatsapp-session-service.md, architecture/whatsapp-session-architecture.md (ADR-036),
 * docs/decisions/architecture-decisions.md (ADR-043).
 */

import { whatsappBridgeEnabled } from "@/lib/config";
import {
  bridgeGetSession,
  bridgeSetMonitors,
  bridgeBackfillChat,
} from "./whatsapp-bridge-client";
import {
  getSessionByTenant,
  listActiveMonitorChatIdsByTenant,
} from "./whatsapp-server";

export interface WhatsAppSyncResult {
  /** Messages the bridge replayed across approved chats (delivered via webhook). */
  readonly itemCount: number;
  /** Approved chats a backfill was successfully requested for. */
  readonly chatCount: number;
  readonly status:
    | "synced"
    | "bridge_disabled"
    | "no_monitors";
}

/**
 * Trigger a backfill for every active WhatsApp monitor of a tenant. Per-chat
 * failures are logged and skipped (one bad chat never aborts the rest);
 * an unauthenticated/absent session throws so the sync is recorded as failed
 * with a clear, actionable reason.
 */
export async function syncActiveWhatsAppMonitors(
  tenantId: string,
  _connectionId: string,
): Promise<WhatsAppSyncResult> {
  if (!whatsappBridgeEnabled()) {
    // Scaffold mode: there is no live session to pull from. Not a failure —
    // there is simply nothing to sync until the bridge is wired in.
    console.log(`[whatsapp/sync] bridge disabled — skipping tenant ${tenantId}`);
    return { itemCount: 0, chatCount: 0, status: "bridge_disabled" };
  }

  const session = await getSessionByTenant(tenantId);
  if (!session) {
    throw new Error(
      "WhatsApp session not started — connect WhatsApp and scan the QR code to begin syncing.",
    );
  }

  // The bridge is the source of truth for live auth state.
  const live = await bridgeGetSession(tenantId);
  if (live.status !== "connected") {
    throw new Error(
      `WhatsApp not connected (session is "${live.status}") — scan the QR code to re-authenticate.`,
    );
  }

  const chatIds = await listActiveMonitorChatIdsByTenant(tenantId);
  if (chatIds.length === 0) {
    return { itemCount: 0, chatCount: 0, status: "no_monitors" };
  }

  // Re-assert the approved-chat allowlist at the bridge boundary before pulling.
  await bridgeSetMonitors(tenantId, chatIds);

  let replayed = 0;
  let chatCount = 0;
  for (const chatId of chatIds) {
    try {
      const res = await bridgeBackfillChat(tenantId, chatId);
      replayed += res.replayed ?? 0;
      chatCount += 1;
      console.log(
        `[whatsapp/sync] tenant ${tenantId} chat ${chatId}: replayed=${res.replayed} requestedHistory=${res.requestedHistory}`,
      );
    } catch (err) {
      // Isolate a single bad chat — keep backfilling the others.
      console.error(
        `[whatsapp/sync] backfill failed for chat ${chatId} (tenant ${tenantId}):`,
        err,
      );
    }
  }

  return { itemCount: replayed, chatCount, status: "synced" };
}
