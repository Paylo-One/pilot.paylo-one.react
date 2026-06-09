"use client";

/**
 * components/sources/scope-item-selector.tsx
 *
 * Generic scope selector for the Google family — Gmail labels (email) or Google
 * calendars (calendar). One Google OAuth grant covers both connections; this
 * selector lets the operator activate which labels/calendars to sync and run a
 * sync. Only active items are ingested — scope is explicit (ADR-026).
 *
 * Governance: architecture/source-integration-strategy.md §8/§9.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SourceScopeItem, SourceType } from "@/modules/source-connection/source.types";
import { updateScopeItemAction, syncGoogleAction } from "@/app/(app)/sources/actions";
import { Toggle } from "./toggle";

function formatSync(value: string | null): string {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "never";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const NOUN: Record<string, { plural: string; singular: string }> = {
  email: { plural: "labels", singular: "label" },
  calendar: { plural: "calendars", singular: "calendar" },
};

export function ScopeItemSelector({
  items,
  connectionId,
  system,
  googleConfigured,
}: {
  items: readonly SourceScopeItem[];
  connectionId: string | null;
  system: SourceType;
  googleConfigured: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const noun = NOUN[system] ?? { plural: "items", singular: "item" };

  const display = useMemo(
    () => items.map((i) => (i.id in overrides ? { ...i, isActive: overrides[i.id]! } : i)),
    [items, overrides],
  );
  const activeCount = display.filter((i) => i.isActive).length;

  // --- Not connected -------------------------------------------------------
  if (!connectionId) {
    return (
      <div className="repo-selector">
        <p className="scaffold-note" style={{ marginBottom: "var(--space-md)" }}>
          {googleConfigured
            ? "Connect Google (read-only). One authorisation covers both Gmail and Calendar; you then choose which labels/calendars to sync."
            : "Google OAuth is not configured. Add GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET to enable."}
        </p>
        {googleConfigured ? (
          <a className="btn btn--secondary btn--sm" href="/api/oauth/google/start">
            Connect Google
          </a>
        ) : (
          <button type="button" className="btn btn--ghost btn--sm" disabled>
            Needs credentials
          </button>
        )}
      </div>
    );
  }

  // --- Connected -----------------------------------------------------------
  function toggle(item: SourceScopeItem) {
    const next = !item.isActive;
    setOverrides((p) => ({ ...p, [item.id]: next }));
    setMessage(null);
    startTransition(async () => {
      const res = await updateScopeItemAction({ scopeItemId: item.id, isActive: next });
      if (!res.ok && res.error) {
        setOverrides((p) => ({ ...p, [item.id]: !next }));
        setMessage(res.error);
      }
    });
  }

  function runSync() {
    setMessage(null);
    startTransition(async () => {
      const res = await syncGoogleAction({ system });
      if (res.ok) {
        setMessage(`Synced ${res.itemCount ?? 0} item(s) from ${res.scopeCount ?? 0} ${noun.plural}.`);
        router.refresh();
      } else {
        setMessage(res.error ?? "Sync failed.");
      }
    });
  }

  return (
    <div className="repo-selector">
      <div className="repo-selector__head">
        <div className="repo-selector__account">
          <span className="integration__glyph" aria-hidden="true">
            G
          </span>
          <div>
            <p className="repo-selector__org">
              {system === "email" ? "Gmail labels" : "Google calendars"}
            </p>
            <p className="integration__kind">
              {display.length} available · {activeCount} active
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={runSync}
          disabled={pending || activeCount === 0}
          title={activeCount === 0 ? `Activate a ${noun.singular} first` : "Sync now"}
        >
          {pending ? "Working…" : "Sync now"}
        </button>
      </div>

      <p className="scaffold-note" style={{ marginBottom: "var(--space-md)" }}>
        {system === "email"
          ? "Read-only. Only the labels you activate are synced (last 7 days)."
          : "Read-only. Only the calendars you activate are synced (today + 7 days)."}
      </p>

      {message ? (
        <p className="form-message form-message--ok" role="status" style={{ marginBottom: "var(--space-md)" }}>
          {message}
        </p>
      ) : null}

      {display.length === 0 ? (
        <div className="empty">
          <p className="empty__title">No {noun.plural} found</p>
          <p className="empty__body">Reconnect Google, or check the granted scopes.</p>
        </div>
      ) : (
        <ul className="repo-list">
          {display.map((item) => (
            <li key={item.id} className={`repo-row${item.isActive ? " repo-row--active" : ""}`}>
              <div className="repo-row__main">
                <p className="repo-row__name">{item.name ?? item.externalId}</p>
                <p className="repo-row__meta mono">
                  {item.isActive ? `active · last sync ${formatSync(item.lastSyncAt)}` : "not synced"}
                </p>
              </div>
              <div className="repo-row__controls">
                <Toggle
                  pressed={item.isActive}
                  onChange={() => toggle(item)}
                  label={`Sync ${item.name ?? noun.singular}`}
                  disabled={pending}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
