"use client";

/**
 * components/notification-bell.tsx
 *
 * The topbar notification bell: a quiet unread indicator and a compact panel
 * of the actions that need attention. Notification tone follows the voice
 * guide: state the fact and the needed action, never manufacture urgency.
 *
 * Accessibility: the trigger is a real button with aria-expanded/aria-controls;
 * the panel closes on Escape (returning focus to the trigger) and on outside
 * interaction; items are plain links so keyboard and screen-reader users get
 * native semantics; the unread count is announced via the button label.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { NotificationView } from "@/modules/notification/server";
import {
  fetchNotifications,
  markNotificationReadAction,
  markAllNotificationsReadAction,
} from "@/app/(app)/notification-actions";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(
    new Date(iso),
  );
}

function targetHref(notification: NotificationView): string {
  if (notification.actionId) return `/actions/${notification.actionId}`;
  return notification.href ?? "/actions";
}

export function NotificationBell({
  initialNotifications,
  initialUnreadCount,
}: {
  readonly initialNotifications: readonly NotificationView[];
  readonly initialUnreadCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<readonly NotificationView[]>(
    initialNotifications,
  );
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(() => {
    startTransition(async () => {
      const snapshot = await fetchNotifications();
      if (snapshot.ok) {
        setNotifications(snapshot.notifications);
        setUnreadCount(snapshot.unreadCount);
      }
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) refresh();
  }

  function openNotification(notification: NotificationView) {
    setOpen(false);
    if (!notification.readAt) {
      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id
            ? { ...item, readAt: new Date().toISOString() }
            : item,
        ),
      );
      setUnreadCount((count) => Math.max(0, count - 1));
      startTransition(async () => {
        await markNotificationReadAction(notification.id);
      });
    }
    router.push(targetHref(notification));
  }

  function markOneRead(notification: NotificationView) {
    if (notification.readAt) return;
    setNotifications((current) =>
      current.map((item) =>
        item.id === notification.id
          ? { ...item, readAt: new Date().toISOString() }
          : item,
      ),
    );
    setUnreadCount((count) => Math.max(0, count - 1));
    startTransition(async () => {
      await markNotificationReadAction(notification.id);
    });
  }

  function markAllRead() {
    const stamp = new Date().toISOString();
    setNotifications((current) =>
      current.map((item) => (item.readAt ? item : { ...item, readAt: stamp })),
    );
    setUnreadCount(0);
    startTransition(async () => {
      await markAllNotificationsReadAction();
    });
  }

  const label =
    unreadCount === 0
      ? "Notifications"
      : `Notifications, ${unreadCount} unread`;

  return (
    <div className="notify" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="notify__trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={toggle}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unreadCount > 0 ? (
          <span className="notify__count" aria-hidden="true">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id="notification-panel"
          className="notify__panel"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="notify__head">
            <span className="notify__title">Notifications</span>
            {unreadCount > 0 ? (
              <button type="button" className="notify__mark-all" onClick={markAllRead}>
                Mark all read
              </button>
            ) : null}
          </div>
          {notifications.length === 0 ? (
            <p className="notify__empty">
              Nothing needs your attention. New actions and briefings will
              appear here.
            </p>
          ) : (
            <ul className="notify__list">
              {notifications.map((notification) => (
                <li
                  key={notification.id}
                  className={`notify__item${notification.readAt ? "" : " notify__item--unread"}`}
                >
                  <button
                    type="button"
                    className="notify__item-main"
                    onClick={() => openNotification(notification)}
                  >
                    <span className="notify__item-title">{notification.title}</span>
                    {notification.body ? (
                      <span className="notify__item-body">{notification.body}</span>
                    ) : null}
                    <span className="notify__item-time">
                      {relativeTime(notification.createdAt)}
                    </span>
                  </button>
                  {!notification.readAt ? (
                    <button
                      type="button"
                      className="notify__item-read"
                      aria-label={`Mark read: ${notification.title}`}
                      title="Mark read"
                      onClick={() => markOneRead(notification)}
                    >
                      <span aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
