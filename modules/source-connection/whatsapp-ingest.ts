import "server-only";

/**
 * modules/source-connection/whatsapp-ingest.ts
 *
 * Ingestion boundary for messages the WhatsApp bridge forwards (ADR-036). This
 * is where the product's monitoring contract is ENFORCED server-side — never
 * trusting that the bridge filtered correctly:
 *
 *  1. The message must match an *active* monitor for the tenant (the explicit
 *     per-chat approval gate). Anything else is dropped.
 *  2. The monitor's storage policy decides whether the raw body is persisted —
 *     enforced here, not in the UI. `no_raw`/`summaries_only` keep no raw body;
 *     `disabled` ingests nothing.
 *
 * Runs in a webhook/job context (no operator session): all writes use the secret
 * client with an explicit tenant_id, and the audit row carries no user.
 *
 * Governance: services/whatsapp-session-service.md ("Message ingestion"),
 * architecture/whatsapp-session-architecture.md §9–11, ADR-035 (retention).
 */

import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { normaliseContent } from "@/modules/normalisation";
import { insertSourceItem } from "@/modules/knowledge-store/server";
import {
  findActiveMonitorByChatId,
  touchMonitorSync,
} from "./whatsapp-server";
import type { BridgeInboundMessage } from "./whatsapp-bridge-client";

export interface IngestResult {
  readonly ingested: boolean;
  /** Why the message was skipped (no active monitor / disabled / etc.). */
  readonly reason?: string;
}

/**
 * Ingest one inbound WhatsApp message subject to the active-monitor gate and the
 * monitor's storage policy. The provider message id is recorded as the
 * source_items external_id (`whatsapp:<id>`) so downstream dedup can key on it.
 */
export async function ingestWhatsAppMessage(msg: BridgeInboundMessage): Promise<IngestResult> {
  const monitor = await findActiveMonitorByChatId(msg.tenantId, msg.chatId);
  if (!monitor) return { ingested: false, reason: "no_active_monitor" };
  if (monitor.storagePolicy === "disabled") return { ingested: false, reason: "disabled" };

  // Dedupe on the provider message id: backfill (buffer replay + on-demand
  // history) and live forwarding may legitimately deliver the same message
  // more than once.
  const externalId = `whatsapp:${msg.providerMessageId}`;
  const dedupe = createSupabaseSecretClient();
  const { data: existing } = await dedupe
    .from("source_items")
    .select("id")
    .eq("tenant_id", msg.tenantId)
    .eq("system", "whatsapp")
    .eq("external_id", externalId)
    .maybeSingle();
  if (existing) return { ingested: false, reason: "duplicate" };

  // Storage-policy enforcement: only `raw_and_summaries` keeps the raw body
  // (under the 90-day raw window, ADR-035). Everything else stores metadata only
  // — the summary is produced downstream by the intelligence lane.
  const keepRaw = monitor.storagePolicy === "raw_and_summaries";
  const normalised = normaliseContent({
    system: "whatsapp",
    title: msg.fromName ?? msg.chatName ?? "WhatsApp message",
    body: msg.body,
    kind: "message",
  });

  const itemId = await insertSourceItem(msg.tenantId, {
    system: "whatsapp",
    externalId,
    kind: normalised.kind,
    title: normalised.title,
    body: keepRaw ? normalised.body : null,
    author: msg.fromName,
    occurredAt: msg.occurredAt,
    raw: keepRaw
      ? { chatId: msg.chatId, chatName: msg.chatName, fromName: msg.fromName }
      : { chatId: msg.chatId, chatName: msg.chatName, storagePolicy: monitor.storagePolicy },
  });

  await touchMonitorSync(monitor.id, msg.occurredAt);

  // System audit (no operator): append directly with a null user.
  const secret = createSupabaseSecretClient();
  await secret.from("audit_events").insert({
    tenant_id: msg.tenantId,
    user_id: null,
    action: "whatsapp.message.ingested",
    target: itemId,
    metadata: {
      chatId: msg.chatId,
      monitorId: monitor.id,
      storagePolicy: monitor.storagePolicy,
      rawKept: keepRaw,
    },
  });

  return { ingested: true };
}
