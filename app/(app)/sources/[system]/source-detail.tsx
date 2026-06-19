"use client";

/**
 * app/(app)/sources/[system]/source-detail.tsx
 *
 * Client half of the source detail view: the operator's full control surface
 * for one source. Connection contract + connect/disconnect, storage policy,
 * Daily Memo inclusion, and the adaptor-specific configuration (GitHub repos,
 * Notion resources, Google scope items, WhatsApp session, uploads).
 *
 * Scaffold sources keep a local activation toggle (not persisted) so the UX
 * stays explorable; wired sources use their real affordances. The card never
 * implies blind ingestion — activation and scope are always explicit.
 */

import { useState } from "react";
import {
  type SourceStoragePolicy,
  type SourceView,
} from "@/modules/source-connection/source.types";
import { ConnectAction } from "@/components/sources/connect-action";
import { StoragePolicySelector } from "@/components/sources/storage-policy-selector";
import { GithubRepositorySelector } from "@/components/sources/github-repository-selector";
import { NotionResourceSelector } from "@/components/sources/notion-resource-selector";
import { ScopeItemSelector } from "@/components/sources/scope-item-selector";
import { ObsidianUploadForm } from "@/components/sources/obsidian-upload-form";
import { WhatsAppSessionCard } from "@/components/sources/whatsapp-session-card";
import { Toggle } from "@/components/sources/toggle";
import { UploadForm } from "../upload-form";
import type { NewsAdminData } from "@/modules/news";
import { NewsSourceConfig } from "@/components/sources/news-source-config";
import { updateSourceSchedulerSettingsAction } from "../actions";

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Selectable auto-refresh cadences (ADR-043). Order = ascending frequency. */
const SYNC_FREQUENCY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "daily", label: "Daily (every 24h)" },
  { value: "twice_a_day", label: "Twice a day (every 12h)" },
  { value: "three_times_a_day", label: "Three times a day (every 8h)" },
  { value: "four_times_a_day", label: "Four times a day (every 6h)" },
];

export function SourceDetail({
  view,
  newsData,
  availableSyncFrequencies = ["daily"],
}: {
  view: SourceView;
  newsData?: NewsAdminData | null;
  /** Cadences the tenant's plan unlocks; others render locked. Always ≥ daily. */
  availableSyncFrequencies?: readonly string[];
}) {
  const hasLockedFrequencies = SYNC_FREQUENCY_OPTIONS.some(
    (o) => !availableSyncFrequencies.includes(o.value),
  );
  const [active, setActive] = useState(view.status === "active");
  const [inMemo, setInMemo] = useState(view.inDailyMemo);
  const [storagePolicy, setStoragePolicy] = useState<SourceStoragePolicy>(
    view.storagePolicy,
  );

  const [autoRefresh, setAutoRefresh] = useState(view.autoRefreshEnabled);
  const [frequency, setSyncFrequency] = useState(view.syncFrequency);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSchedulerChange = async (nextAutoRefresh: boolean, nextFrequency: string) => {
    if (!view.connectionId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await updateSourceSchedulerSettingsAction({
        connectionId: view.connectionId,
        autoRefreshEnabled: nextAutoRefresh,
        syncFrequency: nextFrequency,
      });
      if (!res.ok) {
        setError(res.error || "Failed to update settings.");
        // Revert local UI state on failure
        setAutoRefresh(view.autoRefreshEnabled);
        setSyncFrequency(view.syncFrequency);
      } else {
        setSuccess("Scheduler settings saved successfully.");
        setAutoRefresh(nextAutoRefresh);
        setSyncFrequency(nextFrequency);
      }
    } catch (err) {
      setError("An unexpected error occurred.");
      setAutoRefresh(view.autoRefreshEnabled);
      setSyncFrequency(view.syncFrequency);
    } finally {
      setSaving(false);
    }
  };

  // Scaffold sources expose a (local) activation toggle; wired ones use their
  // real connect/disconnect affordances instead.
  const togglable = view.connect === "scaffold";

  if (view.system === "news" && newsData) {
    return <NewsSourceConfig data={newsData} />;
  }

  return (
    <div className="stack" style={{ gap: "var(--space-lg)" }}>
      {/* --- Connection ---------------------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <h2 className="card__title">Connection</h2>
          <div className="integration__actions">
            {togglable ? (
              <span className="integration__toggle">
                <Toggle
                  pressed={active}
                  onChange={setActive}
                  label={`Activate ${view.name}`}
                />
                <span className="integration__toggle-label">
                  {active ? "Active" : "Inactive"}
                </span>
              </span>
            ) : null}
            <ConnectAction view={view} />
          </div>
        </div>

        <div className="integration__meta">
          <div className="meta-row">
            <span className="meta-row__key">Auth model</span>
            <span className="meta-row__value">{view.authModel}</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Data pulled</span>
            <span className="meta-row__value">{view.dataPulled}</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Scope</span>
            <span className="meta-row__value">{view.scopeControl}</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Last sync</span>
            <span className="meta-row__value mono">{view.lastSync ?? "—"}</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Source references</span>
            <span className="meta-row__value">
              {view.referenceReady ? "Ready" : "—"}
            </span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Tenant scope</span>
            <span className="meta-row__value mono">isolated</span>
          </div>
        </div>
      </section>

      {/* --- Adaptor-specific setup ----------------------------------------- */}
      {view.system === "github" ? (
        <section className="card">
          <h2 className="card__title" style={{ marginBottom: "var(--space-md)" }}>
            Repositories
          </h2>
          <GithubRepositorySelector
            repositories={view.githubRepositories}
            connectionId={view.connectionId}
            configured={view.githubConfigured}
          />
        </section>
      ) : null}

      {view.system === "notion" ? (
        <section className="card">
          <h2 className="card__title" style={{ marginBottom: "var(--space-md)" }}>
            Pages &amp; databases
          </h2>
          <NotionResourceSelector
            resources={view.notionResources}
            connectionId={view.connectionId}
          />
        </section>
      ) : null}

      {view.system === "email" ||
      view.system === "calendar" ||
      view.system === "ms365_mail" ||
      view.system === "teams" ||
      view.system === "slack" ||
      view.system === "discord" ? (
        <section className="card">
          <h2 className="card__title" style={{ marginBottom: "var(--space-md)" }}>
            {view.system === "email"
              ? "Labels to sync"
              : view.system === "calendar"
                ? "Calendars to sync"
                : view.system === "ms365_mail"
                  ? "Folders & calendars to sync"
                  : view.system === "teams"
                    ? "Chats & channels to sync"
                    : "Channels to sync"}
          </h2>
          <ScopeItemSelector
            items={view.scopeItems}
            connectionId={view.connectionId}
            system={view.system}
            configured={
              view.system === "ms365_mail" || view.system === "teams"
                ? view.microsoftConfigured
                : view.system === "slack"
                  ? view.slackConfigured
                  : view.system === "discord"
                    ? view.discordConfigured
                : view.googleConfigured
            }
          />
        </section>
      ) : null}

      {view.system === "whatsapp" ? (
        <section className="card">
          <WhatsAppSessionCard
            session={view.whatsappSession}
            monitors={view.whatsappMonitors}
            bridgeEnabled={view.whatsappBridgeEnabled}
          />
        </section>
      ) : null}

      {view.system === "obsidian" ? (
        <section className="card">
          <h2 className="card__title" style={{ marginBottom: "var(--space-md)" }}>
            Upload notes
          </h2>
          <ObsidianUploadForm />
        </section>
      ) : null}

      {view.system === "file_upload" ? (
        <section className="card">
          <div className="card-head">
            <h2 className="card__title">Add a note or document</h2>
            <span className="badge">no credentials</span>
          </div>
          <p
            className="action-card__rationale"
            style={{ marginTop: 0, marginBottom: "var(--space-lg)" }}
          >
            Paste text or upload a .txt/.md file. It is normalised and stored as
            a source item your briefings can draw on and cite.
          </p>
          <UploadForm />
        </section>
      ) : null}

      {/* --- Automatic Syncing --------------------------------------------- */}
      <section className="card">
        <h2 className="card__title" style={{ marginBottom: "var(--space-md)" }}>
          Automatic Syncing
        </h2>

        {!view.connectionId ? (
          <p className="field__hint" style={{ marginBottom: "var(--space-md)" }}>
            Connect this source to enable automatic background syncing.
          </p>
        ) : null}

        <div className="integration__detail-block" style={{ borderTop: "none", paddingTop: 0, marginTop: 0 }}>
          <span className="integration__toggle">
            <Toggle
              pressed={autoRefresh}
              onChange={(checked) => {
                setAutoRefresh(checked);
                handleSchedulerChange(checked, frequency);
              }}
              label="Enable automatic syncing"
              disabled={!view.connectionId || saving}
            />
            <span className="integration__toggle-label">
              Auto-refresh
            </span>
          </span>
          <p className="segmented__hint">
            When enabled, this source will sync in the background on your schedule.
          </p>
        </div>

        <div className="integration__detail-block">
          <div className="field">
            <label htmlFor="sync_frequency" className="field__label">
              Sync frequency
            </label>
            <select
              id="sync_frequency"
              name="sync_frequency"
              value={frequency}
              onChange={(e) => {
                const val = e.target.value;
                setSyncFrequency(val);
                handleSchedulerChange(autoRefresh, val);
              }}
              disabled={!view.connectionId || !autoRefresh || saving}
              className="input select"
              style={{ height: "42px", padding: "0 12px", maxWidth: "320px" }}
            >
              {SYNC_FREQUENCY_OPTIONS.map((opt) => {
                const locked = !availableSyncFrequencies.includes(opt.value);
                return (
                  <option key={opt.value} value={opt.value} disabled={locked}>
                    {opt.label}
                    {locked ? " 🔒" : ""}
                  </option>
                );
              })}
            </select>
            {hasLockedFrequencies ? (
              <span className="field__hint" style={{ marginTop: "var(--space-xs)", display: "block" }}>
                🔒 More frequent syncing unlocks on the Executive plan and above.
              </span>
            ) : null}
          </div>
        </div>

        <div className="integration__detail-block" style={{ paddingBottom: 0, borderBottom: "none" }}>
          <p className="eyebrow" style={{ marginBottom: "var(--space-md)" }}>
            Scheduler Metadata
          </p>
          <div className="integration__meta" style={{ border: "1px solid var(--colour-border-muted)", borderRadius: "var(--radius-md)", padding: "var(--space-md)" }}>
            <div className="meta-row">
              <span className="meta-row__key">Last Sync Status</span>
              <span className="meta-row__value">
                {view.lastSyncStatus === "success" ? (
                  <span className="status status--ok">✓ SUCCESS</span>
                ) : view.lastSyncStatus === "failed" ? (
                  <span className="status status--risk">✗ FAILED</span>
                ) : view.lastSyncStatus === "syncing" ? (
                  <span className="status status--info">◌ SYNCING...</span>
                ) : (
                  <span className="status status--neutral">—</span>
                )}
              </span>
            </div>
            {view.lastSyncError ? (
              <div className="meta-row" style={{ color: "var(--colour-danger)" }}>
                <span className="meta-row__key" style={{ color: "var(--colour-danger)" }}>Last Sync Error</span>
                <span className="meta-row__value mono" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {view.lastSyncError}
                </span>
              </div>
            ) : null}
            <div className="meta-row">
              <span className="meta-row__key">Next Scheduled Sync</span>
              <span className="meta-row__value mono">
                {autoRefresh && view.connectionId ? formatTimestamp(view.nextSyncAt) : "—"}
              </span>
            </div>
          </div>
        </div>

        {error ? (
          <p className="form-message form-message--error" style={{ marginTop: "var(--space-md)" }}>{error}</p>
        ) : null}
        {success ? (
          <p className="form-message form-message--ok" style={{ marginTop: "var(--space-md)" }}>{success}</p>
        ) : null}
      </section>

      {/* --- Policy & Daily Memo -------------------------------------------- */}
      <section className="card">
        <h2 className="card__title" style={{ marginBottom: "var(--space-md)" }}>
          Storage &amp; daily briefing
        </h2>

        <div className="integration__detail-block" style={{ borderTop: "none", paddingTop: 0, marginTop: 0 }}>
          <p className="eyebrow" style={{ marginBottom: "var(--space-sm)" }}>
            Storage policy
          </p>
          <StoragePolicySelector
            value={storagePolicy}
            onChange={setStoragePolicy}
            idPrefix={`policy-${view.system}`}
          />
        </div>

        <div className="integration__detail-block">
          <span className="integration__toggle">
            <Toggle
              pressed={inMemo}
              onChange={setInMemo}
              label={`Include ${view.name} in the daily briefing`}
              disabled={!view.referenceReady}
            />
            <span className="integration__toggle-label">
              Include in daily briefing
            </span>
          </span>
          <p className="segmented__hint">
            Only approved, active sources inform the daily briefing.
          </p>
        </div>
      </section>

      <p className="scaffold-note">{view.riskNote}</p>
    </div>
  );
}
