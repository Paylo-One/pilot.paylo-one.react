import "server-only";

/**
 * modules/source-connection/whatsapp-bridge-client.ts
 *
 * Server-only HTTP client for the WhatsApp Web-session bridge (ADR-036). The
 * bridge is a long-lived runtime OUTSIDE Vercel/Supabase that holds the real
 * per-tenant WhatsApp Web sessions. This client is the ONLY way the app talks to
 * it: a private, authenticated path (bearer token), called with an explicit
 * `tenantId` per ADR-036's backend ↔ bridge contract. Never imported into a
 * client bundle; the bridge URL/token never reach the browser.
 *
 * The bridge is the source of truth for live session state (QR, connection,
 * discovered chats). Durable session *material* is persisted back into the app's
 * server-only store (whatsapp_session_material) by the bridge over its own
 * callback path — never returned to or handled by this client.
 *
 * Governance: architecture/whatsapp-session-architecture.md (ADR-036),
 * services/whatsapp-session-service.md.
 */

import {
  whatsappBridgeBaseUrl,
  whatsappBridgeAuthToken,
} from "@/lib/config";
import type { WhatsAppSessionStatus } from "./whatsapp.types";

/** A chat/contact the bridge discovered for the tenant's live session. */
export interface BridgeChat {
  readonly id: string; // provider chat id (wid / group jid)
  readonly name: string;
  readonly kind: "direct" | "group";
  readonly participantCount: number;
}

/** Live session snapshot returned by the bridge. */
export interface BridgeSessionState {
  readonly status: WhatsAppSessionStatus;
  /** Short-lived QR string to render while awaiting a scan; null otherwise. */
  readonly qr: string | null;
  readonly deviceLabel: string | null;
  readonly lastConnectedAt: string | null;
}

/** One inbound message the bridge forwards (shape mirrored by the webhook). */
export interface BridgeInboundMessage {
  readonly tenantId: string;
  readonly chatId: string;
  readonly chatName: string | null;
  readonly fromName: string | null;
  readonly body: string;
  readonly occurredAt: string;
  readonly providerMessageId: string;
}

const TIMEOUT_MS = 12_000;

async function bridgeFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${whatsappBridgeBaseUrl()}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        authorization: `Bearer ${whatsappBridgeAuthToken()}`,
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`bridge ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("WhatsApp bridge timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function enc(tenantId: string): string {
  return encodeURIComponent(tenantId);
}

/** Start (or resume) the tenant's session; returns the QR to scan if pending. */
export async function bridgeStartSession(tenantId: string): Promise<BridgeSessionState> {
  return bridgeFetch<BridgeSessionState>(`/sessions/${enc(tenantId)}/start`, {
    method: "POST",
  });
}

/** Poll the tenant's live session state (status + QR + device). */
export async function bridgeGetSession(tenantId: string): Promise<BridgeSessionState> {
  return bridgeFetch<BridgeSessionState>(`/sessions/${enc(tenantId)}`);
}

/** Discover the session's chats/contacts (optionally filtered by a search term). */
export async function bridgeListChats(
  tenantId: string,
  query?: string,
): Promise<BridgeChat[]> {
  const q = query?.trim() ? `?query=${encodeURIComponent(query.trim())}` : "";
  const { chats } = await bridgeFetch<{ chats: BridgeChat[] }>(
    `/sessions/${enc(tenantId)}/chats${q}`,
  );
  return chats;
}

/**
 * Set the allowlist of chat ids the bridge may forward — the enforcement of
 * "monitor approved chats only" at the bridge boundary, not just the UI. The
 * bridge drops messages from any chat not in this set.
 */
export async function bridgeSetMonitors(
  tenantId: string,
  chatIds: readonly string[],
): Promise<void> {
  await bridgeFetch(`/sessions/${enc(tenantId)}/monitors`, {
    method: "PUT",
    body: { chatIds },
  });
}

/** Disconnect: revoke the linked device and wipe session material on the bridge. */
export async function bridgeDisconnect(tenantId: string): Promise<void> {
  await bridgeFetch(`/sessions/${enc(tenantId)}/disconnect`, { method: "POST" });
}
