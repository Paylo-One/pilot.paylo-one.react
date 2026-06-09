/**
 * modules/source-connection/whatsapp.types.ts
 *
 * WhatsApp monitoring by *selected people or chats* — never "monitor
 * everything". Tenant-scoped sessions, QR onboarding, and per-person/chat
 * activation. Pure types + typed mock data (no persistence, no real session).
 *
 * Governance: architecture/whatsapp-session-architecture.md,
 * services/whatsapp-session-service.md, source-integration-strategy.md §11.
 *
 * Scaffold note: NO real WhatsApp connection, NO QR handling, NO session
 * credentials stored. The approach (Business Platform vs Web-session bridge vs
 * export/import) must be validated before production — see the architecture doc.
 */

/** Lifecycle of a tenant's WhatsApp session. */
export type WhatsAppSessionStatus =
  | "disconnected" // no session
  | "awaiting_qr" // QR shown, waiting for the operator to scan
  | "connecting" // handshake after scan
  | "connected" // healthy session
  | "needs_reconnect" // session lapsed; re-scan required
  | "expired" // session expired
  | "error"; // failure state

/** A tenant-scoped WhatsApp session (one per tenant). */
export interface WhatsAppSession {
  readonly id: string;
  readonly status: WhatsAppSessionStatus;
  /** Status of the QR onboarding step. */
  readonly qrCodeStatus: "none" | "pending" | "scanned" | "expired";
  readonly lastConnectedAt: string | null;
  readonly lastHealthCheckAt: string | null;
  readonly disconnectedAt: string | null;
  /** Device label the session is bound to (e.g. "Linked device · iPhone"). */
  readonly deviceLabel: string | null;
}

/** A WhatsApp contact discovered in the (scaffold) session. */
export interface WhatsAppContact {
  readonly id: string;
  readonly name: string;
  /** Masked phone for display; never store more than needed. */
  readonly phoneMasked: string;
  /** Provider contact id (e.g. wid). */
  readonly providerId: string;
  /** Linked person id, if mapped in People Context. */
  readonly personId: string | null;
}

/** A WhatsApp chat (1:1 or group). */
export interface WhatsAppChat {
  readonly id: string;
  readonly name: string;
  readonly kind: "direct" | "group";
  readonly participantCount: number;
  readonly providerId: string;
}

/** Storage policy per source (aligned with the domain StoragePolicy). */
export type WhatsAppStoragePolicy =
  | "raw_and_summaries"
  | "summaries_only"
  | "no_raw"
  | "disabled";

/**
 * Per-person/chat monitoring decision. `isActive` is the explicit approval
 * gate; only active monitors ever inform the Daily Memo.
 */
export interface WhatsAppMonitor {
  readonly id: string;
  readonly chatId: string;
  readonly chatName: string;
  readonly chatKind: "direct" | "group";
  /** Linked person id, if mapped. */
  readonly personId: string | null;
  readonly personName: string | null;
  readonly isActive: boolean;
  readonly includeInDailyMemo: boolean;
  readonly storagePolicy: WhatsAppStoragePolicy;
  readonly lastSyncAt: string | null;
}

/** A normalised WhatsApp message (only ever from an active monitor). */
export interface WhatsAppMessage {
  readonly id: string;
  readonly chatId: string;
  readonly fromName: string;
  readonly preview: string;
  readonly occurredAt: string;
  readonly personId: string | null;
}

// --- Label maps -------------------------------------------------------------

export const WHATSAPP_STATUS_LABELS: Record<WhatsAppSessionStatus, string> = {
  disconnected: "Disconnected",
  awaiting_qr: "Awaiting QR scan",
  connecting: "Connecting",
  connected: "Connected",
  needs_reconnect: "Needs reconnect",
  expired: "Expired",
  error: "Error",
};

export const WHATSAPP_STATUS_TONE: Record<
  WhatsAppSessionStatus,
  "ok" | "info" | "warn" | "risk" | "neutral"
> = {
  disconnected: "neutral",
  awaiting_qr: "info",
  connecting: "info",
  connected: "ok",
  needs_reconnect: "warn",
  expired: "warn",
  error: "risk",
};

// --- Typed mock data (scaffold) ---------------------------------------------

/** A mock disconnected session — the default state before onboarding. */
export const MOCK_WHATSAPP_SESSION: WhatsAppSession = {
  id: "wa_session_mock",
  status: "disconnected",
  qrCodeStatus: "none",
  lastConnectedAt: null,
  lastHealthCheckAt: null,
  disconnectedAt: null,
  deviceLabel: null,
};

/** Mock chats/contacts the operator could choose to monitor. */
export const MOCK_WHATSAPP_CHATS: readonly WhatsAppChat[] = [
  { id: "wa_chat_jacques", name: "Jacques Becker", kind: "direct", participantCount: 2, providerId: "27825550102@c.us" },
  { id: "wa_chat_mara", name: "Mara Lindt", kind: "direct", participantCount: 2, providerId: "27821234567@c.us" },
  { id: "wa_chat_platform", name: "Platform team", kind: "group", participantCount: 8, providerId: "group-platform@g.us" },
  { id: "wa_chat_family", name: "Family group", kind: "group", participantCount: 5, providerId: "group-family@g.us" },
  { id: "wa_chat_vendor", name: "Thunes support", kind: "direct", participantCount: 2, providerId: "1202000000@c.us" },
];

/**
 * Mock monitors. One person is monitored; the rest are available to approve —
 * illustrating that nothing is monitored until the operator opts a chat in.
 */
export const MOCK_WHATSAPP_MONITORS: readonly WhatsAppMonitor[] = [
  {
    id: "wa_mon_jacques",
    chatId: "wa_chat_jacques",
    chatName: "Jacques Becker",
    chatKind: "direct",
    personId: "person_jacques",
    personName: "Jacques Becker",
    isActive: true,
    includeInDailyMemo: true,
    storagePolicy: "no_raw",
    lastSyncAt: "2026-06-08T19:05:00.000Z",
  },
  {
    id: "wa_mon_platform",
    chatId: "wa_chat_platform",
    chatName: "Platform team",
    chatKind: "group",
    personId: null,
    personName: null,
    isActive: false,
    includeInDailyMemo: false,
    storagePolicy: "summaries_only",
    lastSyncAt: null,
  },
];
