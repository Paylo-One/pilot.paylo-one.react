"use client";

/**
 * components/sources/whatsapp-monitor-list.tsx
 *
 * The people/chats currently monitored. Per-monitor: activation, Daily Memo
 * inclusion, storage policy, and last sync. Only active monitors ever inform
 * the Daily Memo. Scaffold: toggles are local (no persistence).
 */

import {
  formatWhatsAppChatLabel,
  type WhatsAppMonitor,
} from "@/modules/source-connection/whatsapp.types";
import { Toggle } from "./toggle";

function formatSync(value: string | null): string {
  if (!value) return "never";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "never"
    : d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const POLICY_LABEL: Record<WhatsAppMonitor["storagePolicy"], string> = {
  raw_and_summaries: "raw + summaries",
  summaries_only: "summaries only",
  no_raw: "no raw",
  disabled: "disabled",
};

export function WhatsAppMonitorList({
  monitors,
  onToggleActive,
  onToggleMemo,
}: {
  monitors: readonly WhatsAppMonitor[];
  onToggleActive: (id: string) => void;
  onToggleMemo: (id: string) => void;
}) {
  if (monitors.length === 0) {
    return (
      <div className="empty">
        <p className="empty__title">No people or chats monitored</p>
        <p className="empty__body">Search your chats below and approve the ones that matter.</p>
      </div>
    );
  }
  return (
    <ul className="repo-list">
      {monitors.map((m) => {
        const label = formatWhatsAppChatLabel(m.chatName, m.chatId, m.chatKind);
        return (
        <li key={m.id} className={`repo-row${m.isActive ? " repo-row--active" : ""}`}>
          <div className="repo-row__main">
            <div className="repo-row__id">
              <p className="repo-row__name">{label}</p>
              <span className="badge">{m.chatKind}</span>
              {m.personName ? <span className="chip chip--accent">{m.personName}</span> : null}
            </div>
            <p className="repo-row__meta mono">
              {m.isActive ? `monitored · last sync ${formatSync(m.lastSyncAt)}` : "not monitored"} ·
              {" "}
              {POLICY_LABEL[m.storagePolicy]} ·{" "}
              {m.includeInDailyMemo ? "in Daily Memo" : "not in memo"}
            </p>
          </div>
          <div className="repo-row__controls" style={{ flexDirection: "column", alignItems: "flex-end", gap: "var(--space-xs)" }}>
            <span className="integration__toggle">
              <Toggle pressed={m.isActive} onChange={() => onToggleActive(m.id)} label={`Monitor ${label}`} />
              <span className="integration__toggle-label">Monitor</span>
            </span>
            <span className="integration__toggle">
              <Toggle pressed={m.includeInDailyMemo} onChange={() => onToggleMemo(m.id)} label={`Include ${label} in Daily Memo`} disabled={!m.isActive} />
              <span className="integration__toggle-label">Daily Memo</span>
            </span>
          </div>
        </li>
        );
      })}
    </ul>
  );
}
