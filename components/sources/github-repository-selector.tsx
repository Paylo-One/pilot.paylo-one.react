"use client";

/**
 * components/sources/github-repository-selector.tsx
 *
 * Repository-level selection + monitoring for GitHub, backed by REAL persisted
 * data. The product principle in practice: Paylo.one monitors the repositories
 * the operator approves — never the whole account. The operator searches the
 * repositories discovered at connect time, activates the ones that matter, and
 * chooses which signals to monitor per repository. Only active repositories are
 * ever synced into the Daily Memo.
 *
 * Changes persist through server actions (RLS-scoped, tenant-isolated). Local
 * state is optimistic for a responsive feel; the page revalidates on the server.
 * Governance: architecture/source-integration-strategy.md §7, ADR-024/025/026.
 */

import { useMemo, useState, useTransition } from "react";
import { SourceIcon } from "./source-icon";
import {
  GITHUB_MONITOR_OPTIONS,
  type GitHubMonitorSettings,
  type GitHubRepositoryMonitor,
} from "@/modules/source-connection/source.types";
import {
  updateRepoMonitorAction,
  syncGithubRepositoriesAction,
} from "@/app/(app)/sources/actions";
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

export function GithubRepositorySelector({
  repositories,
  connectionId,
  configured,
}: {
  repositories: readonly GitHubRepositoryMonitor[];
  connectionId: string | null;
  configured: boolean;
}) {
  const [repos, setRepos] = useState<GitHubRepositoryMonitor[]>(() =>
    repositories.map((r) => ({ ...r, monitors: { ...r.monitors } })),
  );
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false),
    );
  }, [repos, query]);

  const activeCount = repos.filter((r) => r.isActive).length;

  // --- Not connected / not configured states ------------------------------
  if (!configured) {
    return (
      <div className="repo-selector">
        <p className="scaffold-note">
          GitHub OAuth is not configured. Add{" "}
          <span className="mono">GITHUB_OAUTH_CLIENT_ID</span> /{" "}
          <span className="mono">GITHUB_OAUTH_CLIENT_SECRET</span> to enable
          repository selection.
        </p>
      </div>
    );
  }

  if (!connectionId) {
    return (
      <div className="repo-selector">
        <p className="scaffold-note" style={{ marginBottom: "var(--space-md)" }}>
          Connect GitHub to choose which repositories to monitor. Monitor selected
          repositories only — GitHub activity is scoped to the repositories you
          approve.
        </p>
        <a className="btn btn--secondary btn--sm" href="/api/oauth/github/start">
          Connect GitHub
        </a>
      </div>
    );
  }

  // --- Optimistic mutation helpers ----------------------------------------
  function persist(
    monitorId: string,
    patch: {
      isActive?: boolean;
      includeInDailyMemo?: boolean;
      monitors?: Partial<GitHubMonitorSettings>;
    },
    revert: () => void,
  ) {
    startTransition(async () => {
      const res = await updateRepoMonitorAction({ monitorId, ...patch });
      if (!res.ok && res.error) {
        setMessage(res.error);
        setRepos((prev) => {
          revert();
          return [...prev];
        });
      }
    });
  }

  function toggleActive(repo: GitHubRepositoryMonitor) {
    const next = !repo.isActive;
    setRepos((prev) =>
      prev.map((r) => (r.id === repo.id ? { ...r, isActive: next } : r)),
    );
    setMessage(null);
    persist(repo.id, { isActive: next }, () =>
      setRepos((prev) =>
        prev.map((r) => (r.id === repo.id ? { ...r, isActive: !next } : r)),
      ),
    );
  }

  function toggleDailyMemo(repo: GitHubRepositoryMonitor) {
    const next = !repo.includeInDailyMemo;
    setRepos((prev) =>
      prev.map((r) => (r.id === repo.id ? { ...r, includeInDailyMemo: next } : r)),
    );
    setMessage(null);
    persist(repo.id, { includeInDailyMemo: next }, () =>
      setRepos((prev) =>
        prev.map((r) =>
          r.id === repo.id ? { ...r, includeInDailyMemo: !next } : r,
        ),
      ),
    );
  }

  function toggleMonitor(repo: GitHubRepositoryMonitor, key: keyof GitHubMonitorSettings) {
    const next = !repo.monitors[key];
    setRepos((prev) =>
      prev.map((r) =>
        r.id === repo.id ? { ...r, monitors: { ...r.monitors, [key]: next } } : r,
      ),
    );
    setMessage(null);
    persist(repo.id, { monitors: { [key]: next } }, () =>
      setRepos((prev) =>
        prev.map((r) =>
          r.id === repo.id
            ? { ...r, monitors: { ...r.monitors, [key]: !next } }
            : r,
        ),
      ),
    );
  }

  function runSync() {
    setMessage(null);
    startTransition(async () => {
      const res = await syncGithubRepositoriesAction();
      if (res.ok) {
        setMessage(
          `Synced ${res.itemCount ?? 0} item${res.itemCount === 1 ? "" : "s"} from ${res.repositoryCount ?? 0} repositor${res.repositoryCount === 1 ? "y" : "ies"}.`,
        );
        setRepos((prev) =>
          prev.map((r) =>
            r.isActive ? { ...r, lastSyncAt: new Date().toISOString() } : r,
          ),
        );
      } else {
        setMessage(res.error ?? "Sync failed.");
      }
    });
  }

  // --- Connected: the selector --------------------------------------------
  return (
    <div className="repo-selector">
      <div className="repo-selector__head">
        <div className="repo-selector__account">
          <SourceIcon system="github" />
          <div>
            <p className="repo-selector__org">Repositories</p>
            <p className="integration__kind">
              {repos.length} accessible · {activeCount} monitored
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={runSync}
          disabled={pending || activeCount === 0}
          title={activeCount === 0 ? "Activate a repository first" : "Sync now"}
        >
          {pending ? "Working…" : "Sync now"}
        </button>
      </div>

      <p className="scaffold-note" style={{ marginBottom: "var(--space-md)" }}>
        Monitor selected repositories only. GitHub activity is scoped to the
        repositories you approve — nothing is ingested until you activate it.
      </p>

      {message ? (
        <p
          className="form-message form-message--ok"
          role="status"
          style={{ marginBottom: "var(--space-md)" }}
        >
          {message}
        </p>
      ) : null}

      {repos.length === 0 ? (
        <div className="empty">
          <p className="empty__title">No repositories discovered</p>
          <p className="empty__body">
            Reconnect GitHub, or check that the OAuth grant includes repository
            access.
          </p>
        </div>
      ) : (
        <>
          <div className="source-search source-search--inset">
            <span className="source-search__icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.2-3.2" />
              </svg>
            </span>
            <input
              type="search"
              className="input source-search__input"
              placeholder="Search repositories…"
              value={query}
              aria-label="Search repositories"
              onChange={(event) => setQuery(event.target.value)}
            />
            <span className="source-search__count mono">
              {filtered.length} of {repos.length}
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="empty" style={{ marginTop: "var(--space-md)" }}>
              <p className="empty__title">No repositories match</p>
              <p className="empty__body">Try a different search term.</p>
            </div>
          ) : (
            <ul className="repo-list">
              {filtered.map((repo) => {
                const isOpen = expanded === repo.id;
                const monitoredSignals = GITHUB_MONITOR_OPTIONS.filter(
                  (opt) => repo.monitors[opt.key],
                ).length;
                return (
                  <li
                    key={repo.id}
                    className={`repo-row${repo.isActive ? " repo-row--active" : ""}`}
                  >
                    <div className="repo-row__main">
                      <div className="repo-row__id">
                        <p className="repo-row__name mono">{repo.fullName}</p>
                        <span className="badge">{repo.visibility}</span>
                      </div>
                      {repo.description ? (
                        <p className="repo-row__desc">{repo.description}</p>
                      ) : null}
                      <p className="repo-row__meta mono">
                        {repo.isActive
                          ? `${monitoredSignals} signal${monitoredSignals === 1 ? "" : "s"} · last sync ${formatSync(repo.lastSyncAt)}`
                          : "not monitored"}
                      </p>
                    </div>

                    <div className="repo-row__controls">
                      <Toggle
                        pressed={repo.isActive}
                        onChange={() => toggleActive(repo)}
                        label={`Monitor ${repo.fullName}`}
                        disabled={pending}
                      />
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        aria-expanded={isOpen}
                        disabled={!repo.isActive}
                        onClick={() => setExpanded(isOpen ? null : repo.id)}
                      >
                        {isOpen ? "Hide signals" : "Signals"}
                      </button>
                    </div>

                    {isOpen && repo.isActive ? (
                      <div className="repo-monitors">
                        <button
                          type="button"
                          className={`monitor-toggle${repo.includeInDailyMemo ? " monitor-toggle--on" : ""}`}
                          aria-pressed={repo.includeInDailyMemo}
                          disabled={pending}
                          style={{ marginBottom: "var(--space-md)" }}
                          onClick={() => toggleDailyMemo(repo)}
                        >
                          <span className="monitor-toggle__check" aria-hidden="true">
                            {repo.includeInDailyMemo ? "✓" : ""}
                          </span>
                          <span className="monitor-toggle__body">
                            <span className="monitor-toggle__label">
                              Include in Daily Memo
                            </span>
                            <span className="monitor-toggle__hint">
                              Activity still syncs; switch off to keep this
                              repository out of the memo.
                            </span>
                          </span>
                        </button>
                        <p
                          className="eyebrow"
                          style={{ marginBottom: "var(--space-sm)" }}
                        >
                          Monitor per repository
                        </p>
                        <div className="repo-monitors__grid">
                          {GITHUB_MONITOR_OPTIONS.map((opt) => {
                            const on = repo.monitors[opt.key];
                            return (
                              <button
                                key={opt.key}
                                type="button"
                                className={`monitor-toggle${on ? " monitor-toggle--on" : ""}`}
                                aria-pressed={on}
                                disabled={pending}
                                onClick={() => toggleMonitor(repo, opt.key)}
                              >
                                <span
                                  className="monitor-toggle__check"
                                  aria-hidden="true"
                                >
                                  {on ? "✓" : ""}
                                </span>
                                <span className="monitor-toggle__body">
                                  <span className="monitor-toggle__label">
                                    {opt.label}
                                    {opt.conditional ? (
                                      <span className="monitor-toggle__cond">
                                        {" "}
                                        · {opt.conditional}
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="monitor-toggle__hint">
                                    {opt.hint}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
