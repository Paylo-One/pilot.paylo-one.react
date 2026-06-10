import "server-only";

/**
 * modules/source-connection/whatsapp-server.ts
 *
 * Server-only data layer for tenant-scoped WhatsApp sessions + monitors.
 *
 * Client split:
 *  - **Session metadata** (`whatsapp_sessions`) is server-managed: operators only
 *    have SELECT, so lifecycle writes use the SECRET client with an explicit
 *    tenant_id (mirrors how source connections are written from neutral hosts).
 *    Session *material* (real auth/credentials) is NOT stored here — it belongs
 *    in a secret store like `integration_credentials`, and is not created in this
 *    scaffold (no real session yet; approach is validation-gated, ADR-036).
 *  - **Monitors** (`whatsapp_monitors`) are operator-owned: read/written via the
 *    RLS USER client, so tenant isolation is enforced by policy.
 *
 * Governance: services/whatsapp-session-service.md, architecture/whatsapp-session-architecture.md.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import type {
  WhatsAppMonitor,
  WhatsAppSession,
  WhatsAppSessionStatus,
  WhatsAppStoragePolicy,
} from "./whatsapp.types";

// --- Session (RLS read; secret-client lifecycle writes) ---------------------

interface SessionRow {
  id: string;
  status: string;
  qr_code_status: string;
  device_label: string | null;
  last_connected_at: string | null;
  last_health_check_at: string | null;
  disconnected_at: string | null;
}

const SESSION_COLS =
  "id, status, qr_code_status, device_label, last_connected_at, last_health_check_at, disconnected_at";

function mapSession(row: SessionRow): WhatsAppSession {
  return {
    id: row.id,
    status: row.status as WhatsAppSessionStatus,
    qrCodeStatus: row.qr_code_status as WhatsAppSession["qrCodeStatus"],
    deviceLabel: row.device_label,
    lastConnectedAt: row.last_connected_at,
    lastHealthCheckAt: row.last_health_check_at,
    disconnectedAt: row.disconnected_at,
  };
}

/** The tenant's WhatsApp session (one per tenant), or null. RLS user client. */
export async function getWhatsAppSession(): Promise<WhatsAppSession | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("whatsapp_sessions")
    .select(SESSION_COLS)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapSession(data as SessionRow) : null;
}

/**
 * Upsert the tenant's session status (SECRET client; explicit tenant_id). Only
 * the provided fields change; one row per tenant via the unique(tenant_id).
 */
export async function setSessionStatus(
  tenantId: string,
  status: WhatsAppSessionStatus,
  opts?: {
    qrCodeStatus?: WhatsAppSession["qrCodeStatus"];
    deviceLabel?: string | null;
    lastConnectedAt?: string | null;
    disconnectedAt?: string | null;
  },
): Promise<void> {
  const secret = createSupabaseSecretClient();
  const row: Record<string, unknown> = { tenant_id: tenantId, status };
  if (opts?.qrCodeStatus !== undefined) row.qr_code_status = opts.qrCodeStatus;
  if (opts?.deviceLabel !== undefined) row.device_label = opts.deviceLabel;
  if (opts?.lastConnectedAt !== undefined) row.last_connected_at = opts.lastConnectedAt;
  if (opts?.disconnectedAt !== undefined) row.disconnected_at = opts.disconnectedAt;
  const { error } = await secret
    .from("whatsapp_sessions")
    .upsert(row, { onConflict: "tenant_id" });
  if (error) throw new Error(error.message);
}

/** Delete the tenant's session (cascades monitors/contacts/chats). SECRET client. */
export async function deleteSession(tenantId: string): Promise<void> {
  const secret = createSupabaseSecretClient();
  const { error } = await secret.from("whatsapp_sessions").delete().eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
}

// --- Session material (crown jewel; secret client; server-only table) --------
//
// The opaque, bridge-encrypted auth/session blob (ADR-036). Held in
// whatsapp_session_material, which has NO authenticated grant — only the secret
// client (and the bridge via the internal route) ever touches it. The app never
// decrypts the ciphertext; the key lives only on the bridge runtime.

/** Persist (upsert) the tenant's encrypted session material. SECRET client. */
export async function storeSessionMaterial(
  tenantId: string,
  sessionId: string,
  ciphertext: string,
  keyVersion = 1,
): Promise<void> {
  const secret = createSupabaseSecretClient();
  const { error } = await secret.from("whatsapp_session_material").upsert(
    {
      tenant_id: tenantId,
      whatsapp_session_id: sessionId,
      ciphertext,
      key_version: keyVersion,
    },
    { onConflict: "tenant_id" },
  );
  if (error) throw new Error(error.message);
}

/** Read the tenant's encrypted session material (for the bridge to resume). */
export async function getSessionMaterial(
  tenantId: string,
): Promise<{ ciphertext: string; keyVersion: number } | null> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("whatsapp_session_material")
    .select("ciphertext, key_version")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { ciphertext: data.ciphertext as string, keyVersion: data.key_version as number } : null;
}

/** Wipe the tenant's session material (on disconnect/delete). SECRET client. */
export async function deleteSessionMaterial(tenantId: string): Promise<void> {
  const secret = createSupabaseSecretClient();
  const { error } = await secret
    .from("whatsapp_session_material")
    .delete()
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
}

/** Active-monitor chat ids for a session — the bridge forwarding allowlist. */
export async function listActiveMonitorChatIds(sessionId: string): Promise<string[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("whatsapp_monitors")
    .select("chat_id")
    .eq("whatsapp_session_id", sessionId)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { chat_id: string }[]).map((r) => r.chat_id);
}

/** Resolve the active monitor matching an inbound chat id (ingestion gate). */
export async function findActiveMonitorByChatId(
  tenantId: string,
  chatId: string,
): Promise<WhatsAppMonitor | null> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("whatsapp_monitors")
    .select(MONITOR_COLS)
    .eq("tenant_id", tenantId)
    .eq("chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapMonitor(data as MonitorRow) : null;
}

/** Stamp last_sync_at after a successful ingest. SECRET client (job context). */
export async function touchMonitorSync(
  monitorId: string,
  at: string,
  /** Refresh the stored chat name when the bridge has since resolved a real one
      (monitors approved before name resolution keep their bare-number label
      otherwise). */
  chatName?: string | null,
): Promise<void> {
  const secret = createSupabaseSecretClient();
  const patch: Record<string, string> = { last_sync_at: at };
  if (chatName?.trim()) patch.chat_name = chatName.trim();
  const { error } = await secret
    .from("whatsapp_monitors")
    .update(patch)
    .eq("id", monitorId);
  if (error) throw new Error(error.message);
}

/** The tenant's session read via the SECRET client (for job/webhook contexts). */
export async function getSessionByTenant(tenantId: string): Promise<WhatsAppSession | null> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("whatsapp_sessions")
    .select(SESSION_COLS)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapSession(data as SessionRow) : null;
}

// --- Monitors (operator-owned; RLS user client) -----------------------------

interface MonitorRow {
  id: string;
  chat_id: string;
  chat_name: string | null;
  chat_kind: string;
  person_id: string | null;
  is_active: boolean;
  include_in_daily_memo: boolean;
  storage_policy: string;
  last_sync_at: string | null;
}

const MONITOR_COLS =
  "id, chat_id, chat_name, chat_kind, person_id, is_active, include_in_daily_memo, storage_policy, last_sync_at";

function mapMonitor(row: MonitorRow): WhatsAppMonitor {
  return {
    id: row.id,
    chatId: row.chat_id,
    chatName: row.chat_name ?? row.chat_id,
    chatKind: (row.chat_kind as "direct" | "group") ?? "direct",
    personId: row.person_id,
    personName: null, // resolved via People Context later
    isActive: row.is_active,
    includeInDailyMemo: row.include_in_daily_memo,
    storagePolicy: row.storage_policy as WhatsAppStoragePolicy,
    lastSyncAt: row.last_sync_at,
  };
}

/** List the monitors for a session (RLS user client). */
export async function listWhatsAppMonitors(sessionId: string): Promise<WhatsAppMonitor[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("whatsapp_monitors")
    .select(MONITOR_COLS)
    .eq("whatsapp_session_id", sessionId)
    .order("chat_name", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as MonitorRow[]).map(mapMonitor);
}

/** Approve a chat for monitoring (RLS user client). Active by default. */
export async function createMonitor(
  tenantId: string,
  sessionId: string,
  input: { chatId: string; chatName: string; chatKind: "direct" | "group" },
): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("whatsapp_monitors")
    .insert({
      tenant_id: tenantId,
      whatsapp_session_id: sessionId,
      chat_id: input.chatId,
      chat_name: input.chatName,
      chat_kind: input.chatKind,
      is_active: true,
      include_in_daily_memo: false,
      storage_policy: "no_raw",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "monitor_create_failed");
  return data.id as string;
}

/** Update a monitor's activation / memo inclusion / storage policy (RLS). */
export async function updateMonitor(
  monitorId: string,
  patch: { isActive?: boolean; includeInDailyMemo?: boolean; storagePolicy?: WhatsAppStoragePolicy },
): Promise<boolean> {
  const update: Record<string, unknown> = {};
  if (patch.isActive !== undefined) update.is_active = patch.isActive;
  if (patch.includeInDailyMemo !== undefined) update.include_in_daily_memo = patch.includeInDailyMemo;
  if (patch.storagePolicy !== undefined) update.storage_policy = patch.storagePolicy;
  if (Object.keys(update).length === 0) return false;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("whatsapp_monitors")
    .update(update)
    .eq("id", monitorId)
    .select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

/** Stop monitoring a chat (RLS user client). */
export async function removeMonitor(monitorId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("whatsapp_monitors").delete().eq("id", monitorId);
  if (error) throw new Error(error.message);
}
