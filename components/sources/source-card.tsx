"use client";

/**
 * components/sources/source-card.tsx
 *
 * One source on the Connected Sources page. Merges the designed catalogue entry
 * with live connection state (via the SourceView built server-side) and exposes
 * the operator's control surface: status, storage policy, last sync, source-
 * reference readiness, Daily Memo inclusion, and activate / configure controls.
 *
 * Real affordances where they exist (GitHub OAuth connect/disconnect, file
 * upload); scaffolded control surface elsewhere. The card never implies blind
 * ingestion — activation and scope are always explicit.
 */

import { useState } from "react";
import {
  SOURCE_STATUS_LABELS,
  SOURCE_STATUS_TONE,
  MVP_STATUS_LABELS,
  type SourceStoragePolicy,
  type SourceView,
} from "@/modules/source-connection/source.types";
import { DisconnectButton } from "@/app/(app)/sources/disconnect-button";
import { StoragePolicySelector } from "./storage-policy-selector";
import { GithubRepositorySelector } from "./github-repository-selector";
import { NotionResourceSelector } from "./notion-resource-selector";
import { ScopeItemSelector } from "./scope-item-selector";
import { ObsidianUploadForm } from "./obsidian-upload-form";
import { WhatsAppSessionCard } from "./whatsapp-session-card";
import { Toggle } from "./toggle";

export interface SourceCardState {
  readonly active: boolean;
  readonly inMemo: boolean;
  readonly storagePolicy: SourceStoragePolicy;
}

export function SourceCard({
  view,
  state,
  onToggleActive,
  onToggleMemo,
  onStoragePolicyChange,
}: {
  view: SourceView;
  state: SourceCardState;
  onToggleActive: (next: boolean) => void;
  onToggleMemo: (next: boolean) => void;
  onStoragePolicyChange: (next: SourceStoragePolicy) => void;
}) {
  const [open, setOpen] = useState(false);

  const tone = SOURCE_STATUS_TONE[view.status];
  // Scaffold sources expose a (local) activation toggle; wired ones use their
  // real connect/disconnect affordances instead.
  const togglable = view.connect === "scaffold";

  return (
    <article className={`integration${state.active ? " integration--active" : ""}`}>
      <div className="integration__head">
        <div className="integration__id">
          <span className="integration__glyph" aria-hidden="true">
            {view.glyph}
          </span>
          <div>
            <p className="integration__name">{view.name}</p>
            <p className="integration__kind">{view.provider}</p>
          </div>
        </div>
        <span className={`status status--${tone}`}>
          {SOURCE_STATUS_LABELS[view.status]}
        </span>
      </div>

      <p className="action-card__rationale" style={{ marginTop: 0 }}>
        {view.description}
      </p>

      <div className="integration__meta">
        <div className="meta-row">
          <span className="meta-row__key">Storage policy</span>
          <span className="badge badge--plain">
            {state.storagePolicy === "raw_and_summaries"
              ? "raw + summaries"
              : state.storagePolicy === "summaries_only"
                ? "summaries only"
                : state.storagePolicy === "no_raw"
                  ? "no raw"
                  : "disabled"}
          </span>
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
          <span className="meta-row__key">In Daily Memo</span>
          <span className="meta-row__value">
            {state.active && state.inMemo && view.referenceReady ? "Yes" : "No"}
          </span>
        </div>
        <div className="meta-row">
          <span className="meta-row__key">Tenant scope</span>
          <span className="meta-row__value mono">isolated</span>
        </div>
      </div>

      <div className="integration__footer">
        <span className="badge">{MVP_STATUS_LABELS[view.mvpStatus]}</span>

        <div className="integration__actions">
          {togglable ? (
            <span className="integration__toggle">
              <Toggle
                pressed={state.active}
                onChange={onToggleActive}
                label={`Activate ${view.name}`}
              />
              <span className="integration__toggle-label">
                {state.active ? "Active" : "Inactive"}
              </span>
            </span>
          ) : null}

          {renderConnectAffordance(view)}

          <button
            type="button"
            className="btn btn--ghost btn--sm"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Close" : "Configure"}
          </button>
        </div>
      </div>

      {open ? (
        <div className="integration__detail">
          <div className="meta-row">
            <span className="meta-row__key">Scope</span>
            <span className="meta-row__value">{view.scopeControl}</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Auth model</span>
            <span className="meta-row__value">{view.authModel}</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Data pulled</span>
            <span className="meta-row__value">{view.dataPulled}</span>
          </div>

          <div className="integration__detail-block">
            <p className="eyebrow" style={{ marginBottom: "var(--space-sm)" }}>
              Storage policy
            </p>
            <StoragePolicySelector
              value={state.storagePolicy}
              onChange={onStoragePolicyChange}
              idPrefix={`policy-${view.system}`}
            />
          </div>

          <div className="integration__detail-block">
            <span className="integration__toggle">
              <Toggle
                pressed={state.inMemo}
                onChange={onToggleMemo}
                label={`Include ${view.name} in the Daily Memo`}
                disabled={!view.referenceReady}
              />
              <span className="integration__toggle-label">
                Include in Daily Memo
              </span>
            </span>
            <p className="segmented__hint">
              Only approved, active sources inform the Daily Memo.
            </p>
          </div>

          {view.system === "github" ? (
            <div className="integration__detail-block">
              <GithubRepositorySelector
                repositories={view.githubRepositories}
                connectionId={view.connectionId}
                configured={view.githubConfigured}
              />
            </div>
          ) : null}

          {view.system === "obsidian" ? (
            <div className="integration__detail-block">
              <ObsidianUploadForm />
            </div>
          ) : null}

          {view.system === "notion" ? (
            <div className="integration__detail-block">
              <NotionResourceSelector
                resources={view.notionResources}
                connectionId={view.connectionId}
              />
            </div>
          ) : null}

          {view.system === "email" || view.system === "calendar" ? (
            <div className="integration__detail-block">
              <ScopeItemSelector
                items={view.scopeItems}
                connectionId={view.connectionId}
                system={view.system}
                googleConfigured={view.googleConfigured}
              />
            </div>
          ) : null}

          {view.system === "whatsapp" ? (
            <div className="integration__detail-block">
              <WhatsAppSessionCard
                session={view.whatsappSession}
                monitors={view.whatsappMonitors}
              />
            </div>
          ) : null}

          <p className="scaffold-note">{view.riskNote}</p>
        </div>
      ) : null}
    </article>
  );
}

/** The real (or honestly-disabled) connect control for a source. */
function renderConnectAffordance(view: SourceView): React.ReactNode {
  const connected = view.connectionId !== null;

  switch (view.connect) {
    case "github_oauth":
      if (connected && view.connectionId) {
        return <DisconnectButton connectionId={view.connectionId} />;
      }
      return view.githubConfigured ? (
        <a className="btn btn--secondary btn--sm" href="/api/oauth/github/start">
          Connect
        </a>
      ) : (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled
          title="Add GITHUB_OAUTH_CLIENT_ID / SECRET to enable"
        >
          Needs credentials
        </button>
      );
    case "google_oauth":
      if (connected && view.connectionId) {
        return <DisconnectButton connectionId={view.connectionId} />;
      }
      return view.googleConfigured ? (
        <a className="btn btn--secondary btn--sm" href="/api/oauth/google/start">
          Connect
        </a>
      ) : (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled
          title="Add GOOGLE_OAUTH_CLIENT_ID / SECRET to enable"
        >
          Needs credentials
        </button>
      );
    case "file_upload":
      return (
        <a className="btn btn--secondary btn--sm" href="#upload">
          Add a note
        </a>
      );
    case "enterprise":
      return (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled
          title="Requires enterprise / admin consent"
        >
          Admin consent
        </button>
      );
    case "phased":
      return (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled
          title="Phased — connection deliberately deferred"
        >
          Phased
        </button>
      );
    case "scaffold":
    default:
      return null;
  }
}
