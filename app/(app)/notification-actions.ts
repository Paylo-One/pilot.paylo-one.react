"use server";

/**
 * Server actions behind the notification bell. Every call re-establishes the
 * tenant context (verified session + validated host) and the queries carry the
 * explicit tenant/user predicates on top of RLS.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationView,
} from "@/modules/notification/server";

export interface NotificationsSnapshot {
  readonly ok: boolean;
  readonly notifications: NotificationView[];
  readonly unreadCount: number;
}

export async function fetchNotifications(): Promise<NotificationsSnapshot> {
  try {
    const ctx = await requireTenantContext();
    const { notifications, unreadCount } = await listNotifications(ctx);
    return { ok: true, notifications, unreadCount };
  } catch {
    return { ok: false, notifications: [], unreadCount: 0 };
  }
}

export async function markNotificationReadAction(
  notificationId: string,
): Promise<{ ok: boolean }> {
  try {
    if (!notificationId) return { ok: false };
    const ctx = await requireTenantContext();
    await markNotificationRead(ctx, notificationId);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function markAllNotificationsReadAction(): Promise<{ ok: boolean }> {
  try {
    const ctx = await requireTenantContext();
    await markAllNotificationsRead(ctx);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
