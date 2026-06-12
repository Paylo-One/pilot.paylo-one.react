"use client";

/**
 * components/sources/notion-resource-selector.tsx
 *
 * Notion connector UI (internal-integration token). When not connected, the
 * operator pastes their integration secret (their own credential, into their own
 * app). Once connected, we list the pages/databases they shared with the
 * integration; the operator activates which to sync. Only active resources feed
 * the Daily Memo — scope is what you share AND approve, never the whole
 * workspace. Changes persist through tenant-scoped server actions.
 *
 * Governance: architecture/source-integration-strategy.md §12, ADR-025/026.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { NotionResource } from "@/modules/source-connection/source.types";
import {
  connectNotionAction,
  updateNotionResourceAction,
  syncNotionAction,
} from "@/app/(app)/sources/actions";
import { Toggle } from "./toggle";
import { SourceIcon } from "./source-icon";

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

export function NotionResourceSelector({
  resources,
  connectionId,
}: {
  resources: readonly NotionResource[];
  connectionId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [query, setQuery] = useState("");
  // Optimistic active overrides keyed by resource row id.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const display = useMemo(
    () =>
      resources.map((r) =>
        r.id in overrides ? { ...r, isActive: overrides[r.id]! } : r,
      ),
    [resources, overrides],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return display;
    return display.filter((r) => (r.title ?? "").toLowerCase().includes(q));
  }, [display, query]);

  const activeCount = display.filter((r) => r.isActive).length;

  // --- Not connected: token connect form ----------------------------------
  if (!connectionId) {
    return (
      <div className="repo-selector">
        <p className="scaffold-note" style={{ marginBottom: "var(--space-md)" }}>
          Connect Notion with an integration token. Create an integration at{" "}
          <span className="mono">notion.so/my-integrations</span>, share the
          pages/databases you want with it, then paste its secret here. Only what
          you share is visible, and only what you activate is synced.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <label
            htmlFor="notion-token"
            style={{ fontSize: "var(--text-small)", color: "var(--colour-text-secondary)" }}
          >
            Integration token
          </label>
          <input
            id="notion-token"
            type="password"
            className="input"
            placeholder="secret_…"
            value={token}
            autoComplete="off"
            disabled={pending}
            onChange={(e) => setToken(e.target.value)}
          />
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={pending || token.trim().length === 0}
              onClick={() =>
                startTransition(async () => {
                  setMessage(null);
                  const res = await connectNotionAction({ token: token.trim() });
                  if (res.ok) {
                    setToken("");
                    setMessage(`Connected — ${res.discovered ?? 0} shared resource(s) found.`);
                    router.refresh();
                  } else {
                    setMessage(res.error ?? "Connection failed.");
                  }
                })
              }
            >
              {pending ? "Connecting…" : "Connect Notion"}
            </button>
            {message ? (
              <span
                role="status"
                style={{ fontSize: "var(--text-small)", color: "var(--colour-text-secondary)" }}
              >
                {message}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // --- Connected: resource selector ---------------------------------------
  function toggleActive(resource: NotionResource) {
    const next = !resource.isActive;
    setOverrides((prev) => ({ ...prev, [resource.id]: next }));
    setMessage(null);
    startTransition(async () => {
      const res = await updateNotionResourceAction({ resourceId: resource.id, isActive: next });
      if (!res.ok && res.error) {
        setOverrides((prev) => ({ ...prev, [resource.id]: !next }));
        setMessage(res.error);
      }
    });
  }

  function runSync() {
    setMessage(null);
    startTransition(async () => {
      const res = await syncNotionAction();
      if (res.ok) {
        setMessage(
          `Synced ${res.itemCount ?? 0} item(s) from ${res.resourceCount ?? 0} resource(s).`,
        );
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
          <SourceIcon system="notion" />
          <div>
            <p className="repo-selector__org">Shared with Notion</p>
            <p className="integration__kind">
              {display.length} shared · {activeCount} active
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={runSync}
          disabled={pending || activeCount === 0}
          title={activeCount === 0 ? "Activate a resource first" : "Sync now"}
        >
          {pending ? "Working…" : "Sync now"}
        </button>
      </div>

      <p className="scaffold-note" style={{ marginBottom: "var(--space-md)" }}>
        Connected sources remain tenant-scoped and source-referenced. Only the
        pages you activate are synced.
      </p>

      {message ? (
        <p className="form-message form-message--ok" role="status" style={{ marginBottom: "var(--space-md)" }}>
          {message}
        </p>
      ) : null}

      {display.length === 0 ? (
        <div className="empty">
          <p className="empty__title">No shared resources</p>
          <p className="empty__body">
            Share a page or database with your integration in Notion, then sync.
          </p>
        </div>
      ) : (
        <>
          <div className="source-search source-search--inset">
            <span className="source-search__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.2-3.2" />
              </svg>
            </span>
            <input
              type="search"
              className="input source-search__input"
              placeholder="Search shared pages…"
              value={query}
              aria-label="Search shared Notion pages"
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="source-search__count mono">
              {filtered.length} of {display.length}
            </span>
          </div>

          <ul className="repo-list">
            {filtered.map((resource) => (
              <li
                key={resource.id}
                className={`repo-row${resource.isActive ? " repo-row--active" : ""}`}
              >
                <div className="repo-row__main">
                  <div className="repo-row__id">
                    <p className="repo-row__name">{resource.title ?? "Untitled"}</p>
                    <span className="badge">{resource.objectType}</span>
                  </div>
                  <p className="repo-row__meta mono">
                    {resource.isActive
                      ? `active · last sync ${formatSync(resource.lastSyncAt)}`
                      : "not synced"}
                  </p>
                </div>
                <div className="repo-row__controls">
                  <Toggle
                    pressed={resource.isActive}
                    onChange={() => toggleActive(resource)}
                    label={`Sync ${resource.title ?? "resource"}`}
                    disabled={pending}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
