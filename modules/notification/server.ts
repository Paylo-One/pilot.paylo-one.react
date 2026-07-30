import "server-only";

/**
 * modules/notification/server.ts
 *
 * In-app notifications: high-signal, low-noise nudges. One row per underlying
 * event, enforced by the (tenant_id, user_id, kind, dedupe_key) unique key, so
 * a re-run pipeline or a repeated cron tick never produces a second nudge.
 *
 * Writes go through the secret client (background jobs have no session) with
 * an explicit tenant_id on every row. Reads and read-state changes go through
 * the user server client, so RLS enforces that a user only ever sees and
 * touches their own notifications; the explicit predicates are defence in
 * depth.
 */

import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/modules/shared";

export type NotificationKind =
  | "actions_to_review"
  | "actions_overdue"
  | "briefing_ready"
  | "action_assigned";

export interface NotificationView {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string | null;
  readonly actionId: string | null;
  readonly href: string | null;
  readonly readAt: string | null;
  readonly createdAt: string;
}

export interface RecordNotificationInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body?: string | null;
  readonly actionId?: string | null;
  readonly href?: string | null;
  /** Identifies the underlying event; repeats are dropped, not duplicated. */
  readonly dedupeKey: string;
}

/**
 * Record a notification once. A conflict on the dedupe key means the event was
 * already surfaced; the call is a no-op and reports `created: false`.
 */
export async function recordNotification(
  input: RecordNotificationInput,
): Promise<{ created: boolean }> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("notifications")
    .upsert(
      {
        tenant_id: input.tenantId,
        user_id: input.userId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        action_id: input.actionId ?? null,
        href: input.href ?? null,
        dedupe_key: input.dedupeKey,
      },
      {
        onConflict: "tenant_id,user_id,kind,dedupe_key",
        ignoreDuplicates: true,
      },
    )
    .select("id");
  if (error) throw new Error(error.message);
  return { created: (data ?? []).length > 0 };
}

const NOTIFICATION_LIST_LIMIT = 30;

interface NotificationRow {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  action_id: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
}

/** The user's recent notifications plus their unread count. */
export async function listNotifications(
  ctx: TenantContext,
): Promise<{ notifications: NotificationView[]; unreadCount: number }> {
  const supabase = await createSupabaseServerClient();

  const [{ data: rows }, { count }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, kind, title, body, action_id, href, read_at, created_at")
      .eq("tenant_id", ctx.tenantId)
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(NOTIFICATION_LIST_LIMIT),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId)
      .eq("user_id", ctx.userId)
      .is("read_at", null),
  ]);

  return {
    notifications: ((rows ?? []) as NotificationRow[]).map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      actionId: row.action_id,
      href: row.href,
      readAt: row.read_at,
      createdAt: row.created_at,
    })),
    unreadCount: count ?? 0,
  };
}

/** Mark one notification read. Scoped to the caller's tenant and user. */
export async function markNotificationRead(
  ctx: TenantContext,
  notificationId: string,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.userId)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}

/** Mark every unread notification read for the caller. */
export async function markAllNotificationsRead(ctx: TenantContext): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.userId)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}
