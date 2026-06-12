"use client";

/**
 * components/sources/whatsapp-session-card.tsx
 *
 * Tenant-scoped WhatsApp session control, backed by PERSISTED session metadata +
 * monitors. Session lifecycle (start → QR → connected → pause/disconnect) and the
 * operator's approved people/chats persist to the real tables (RLS-isolated).
 *
 * Two modes (ADR-036), chosen by the `bridgeEnabled` flag:
 *  - Bridge ON: the real Web-session bridge drives QR onboarding and chat
 *    discovery; the QR is live and the session links a real device.
 *  - Bridge OFF (default): the persisted scaffold — "Simulate scan" flips the
 *    status and discovery returns mock chats — so the UX stays explorable
 *    without a bridge, and no real session/credentials are established.
 *
 * Principle: WhatsApp monitoring is tenant-scoped and source-referenced, and only
 * monitors the people or chats the operator approves.
 */

import { useCallback, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SourceIcon } from "./source-icon";
import {
  WHATSAPP_STATUS_LABELS,
  WHATSAPP_STATUS_TONE,
  type WhatsAppChat,
  type WhatsAppMonitor,
  type WhatsAppSession,
} from "@/modules/source-connection/whatsapp.types";
import {
  startWhatsAppSessionAction,
  simulateWhatsAppScanAction,
  pauseWhatsAppAction,
  disconnectWhatsAppAction,
  approveWhatsAppChatAction,
  updateWhatsAppMonitorAction,
} from "@/app/(app)/sources/actions";
import { WhatsAppQrOnboarding } from "./whatsapp-qr-onboarding";
import { WhatsAppContactSelector } from "./whatsapp-contact-selector";
import { WhatsAppMonitorList } from "./whatsapp-monitor-list";

export function WhatsAppSessionCard({
  session,
  monitors,
  bridgeEnabled,
}: {
  session: WhatsAppSession | null;
  monitors: readonly WhatsAppMonitor[];
  bridgeEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const status = session?.status ?? "disconnected";
  const connected = status === "connected";
  const onboarding = status === "awaiting_qr" || status === "connecting";
  const monitoredChatIds = useMemo(() => new Set(monitors.map((m) => m.chatId)), [monitors]);
  const activeCount = monitors.filter((m) => m.isActive).length;

  function run(action: () => Promise<{ ok: boolean; error: string | null }>) {
    startTransition(async () => {
      const res = await action();
      if (res.ok) router.refresh();
    });
  }

  const onConnected = useCallback(() => router.refresh(), [router]);

  return (
    <div className="wa-session">
      <div className="wa-session__head">
        <div className="repo-selector__account">
          <SourceIcon system="whatsapp" />
          <div>
            <p className="repo-selector__org">WhatsApp session</p>
            <p className="integration__kind">
              tenant-scoped · {monitors.length} chats · {activeCount} monitored
            </p>
          </div>
        </div>
        <span className={`status status--${WHATSAPP_STATUS_TONE[status]}`}>
          {WHATSAPP_STATUS_LABELS[status]}
        </span>
      </div>

      {bridgeEnabled ? (
        <p className="scaffold-note" style={{ marginBottom: "var(--space-md)" }}>
          WhatsApp sessions are tenant-scoped and only monitor approved people or
          chats. The Web-session bridge is live for this workspace (ADR-036):
          session material is encrypted, server-only, and isolated per tenant.
        </p>
      ) : (
        <p className="scaffold-note" style={{ marginBottom: "var(--space-md)" }}>
          WhatsApp sessions are tenant-scoped and only monitor approved people or
          chats. Scaffold — session state + selections persist, but there is no
          real session, credentials, or messages yet (Web-session bridge disabled,
          ADR-036).
        </p>
      )}

      {onboarding ? (
        <>
          <WhatsAppQrOnboarding
            bridgeEnabled={bridgeEnabled}
            onCancel={() => run(disconnectWhatsAppAction)}
            onConnected={onConnected}
          />
          {!bridgeEnabled ? (
            <div style={{ marginTop: "var(--space-md)" }}>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={pending}
                onClick={() => run(simulateWhatsAppScanAction)}
              >
                Simulate successful scan
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {!connected && !onboarding ? (
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={pending}
          onClick={() => run(startWhatsAppSessionAction)}
        >
          {status === "needs_reconnect" || status === "expired"
            ? "Reconnect WhatsApp"
            : "Start WhatsApp session"}
        </button>
      ) : null}

      {connected ? (
        <>
          <div className="integration__meta">
            <div className="meta-row">
              <span className="meta-row__key">Session health</span>
              <span className="meta-row__value">{bridgeEnabled ? "healthy · live" : "healthy · scaffold"}</span>
            </div>
            <div className="meta-row">
              <span className="meta-row__key">Linked device</span>
              <span className="meta-row__value mono">{session?.deviceLabel ?? "—"}</span>
            </div>
            <div className="meta-row">
              <span className="meta-row__key">Tenant scope</span>
              <span className="meta-row__value mono">isolated</span>
            </div>
          </div>

          <div className="integration__actions" style={{ marginTop: "var(--space-md)", justifyContent: "flex-start" }}>
            <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => run(pauseWhatsAppAction)}>
              Pause
            </button>
            <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => run(disconnectWhatsAppAction)}>
              Disconnect &amp; delete session
            </button>
          </div>

          <div className="integration__detail-block">
            <p className="eyebrow" style={{ marginBottom: "var(--space-sm)" }}>Monitored people &amp; chats</p>
            <WhatsAppMonitorList
              monitors={monitors}
              onToggleActive={(id) => {
                const m = monitors.find((x) => x.id === id);
                if (m) run(() => updateWhatsAppMonitorAction({ monitorId: id, isActive: !m.isActive }));
              }}
              onToggleMemo={(id) => {
                const m = monitors.find((x) => x.id === id);
                if (m) run(() => updateWhatsAppMonitorAction({ monitorId: id, includeInDailyMemo: !m.includeInDailyMemo }));
              }}
            />
          </div>

          <div className="integration__detail-block">
            <p className="eyebrow" style={{ marginBottom: "var(--space-sm)" }}>Add people or chats</p>
            <WhatsAppContactSelector
              monitoredChatIds={monitoredChatIds}
              onApprove={(chat: WhatsAppChat) =>
                run(() => approveWhatsAppChatAction({ chatId: chat.id, chatName: chat.name, chatKind: chat.kind }))
              }
            />
            <p className="segmented__hint">
              {bridgeEnabled
                ? "Discovered from your linked session — your selections are the approval gate."
                : "Chat discovery is mock until the bridge is enabled — your selections persist."}
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
