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

export function SourceDetail({ view }: { view: SourceView }) {
  const [active, setActive] = useState(view.status === "active");
  const [inMemo, setInMemo] = useState(view.inDailyMemo);
  const [storagePolicy, setStoragePolicy] = useState<SourceStoragePolicy>(
    view.storagePolicy,
  );

  // Scaffold sources expose a (local) activation toggle; wired ones use their
  // real connect/disconnect affordances instead.
  const togglable = view.connect === "scaffold";

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

      {view.system === "email" || view.system === "calendar" ? (
        <section className="card">
          <h2 className="card__title" style={{ marginBottom: "var(--space-md)" }}>
            {view.system === "email" ? "Labels to sync" : "Calendars to sync"}
          </h2>
          <ScopeItemSelector
            items={view.scopeItems}
            connectionId={view.connectionId}
            system={view.system}
            googleConfigured={view.googleConfigured}
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

      {/* --- Policy & Daily Memo -------------------------------------------- */}
      <section className="card">
        <h2 className="card__title" style={{ marginBottom: "var(--space-md)" }}>
          Storage &amp; Daily Memo
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
      </section>

      <p className="scaffold-note">{view.riskNote}</p>
    </div>
  );
}
