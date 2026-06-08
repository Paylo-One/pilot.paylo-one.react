/**
 * Sources — connect/manage integrations + bring real context into the
 * workspace. Two working ingestion paths: file/paste upload (no credentials)
 * and GitHub OAuth (when configured). Every other integration is designed and
 * scaffolded, presented as a card with its connection contract. Governance:
 * integration-architecture.md, services/source-connection.md, ingestion.md.
 *
 * Server Component: reads connections + recent items with the RLS user client,
 * then merges real connection state into the designed source catalogue.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import { listSourceConnections } from "@/modules/source-connection/server";
import type { SourceConnection } from "@/modules/source-connection";
import { isGithubOAuthConfigured } from "@/modules/source-connection/github";
import { listRecentSourceItems } from "@/modules/knowledge-store/server";
import { SOURCE_SYSTEM_LABELS } from "@/modules/source-connection";
import {
  SOURCE_CATALOGUE,
  STORAGE_POLICY_LABELS,
  TIER_LABELS,
  type SourceCatalogueEntry,
} from "./catalogue";
import { UploadForm } from "./upload-form";
import { DisconnectButton } from "./disconnect-button";

function formatTimestamp(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function githubNotice(
  github: string | undefined,
): { message: string; ok: boolean } | null {
  switch (github) {
    case "connected":
      return { message: "GitHub connected — recent activity imported.", ok: true };
    case "unconfigured":
      return { message: "GitHub OAuth is not configured.", ok: false };
    case "error":
      return { message: "GitHub connection failed. Please try again.", ok: false };
    case "denied":
      return { message: "GitHub authorisation was cancelled.", ok: false };
    default:
      return null;
  }
}

/** A single integration card, merging real connection state into the design. */
function IntegrationCard({
  entry,
  connection,
  githubConfigured,
}: {
  entry: SourceCatalogueEntry;
  connection: SourceConnection | undefined;
  githubConfigured: boolean;
}) {
  const connected = connection?.status === "connected";
  const policy = connection?.storagePolicy ?? entry.defaultPolicy;
  const lastSync = formatTimestamp(connection?.updatedAt ?? null);

  let statusNode: React.ReactNode;
  if (connected) {
    statusNode = <span className="status status--ok">Connected</span>;
  } else if (connection?.status === "error") {
    statusNode = <span className="status status--risk">Needs reconnect</span>;
  } else {
    statusNode = (
      <span className="status status--neutral">
        {entry.tier === "phased" ? "Phased" : "Not connected"}
      </span>
    );
  }

  return (
    <article className="integration">
      <div className="integration__head">
        <div className="integration__id">
          <span className="integration__glyph" aria-hidden="true">
            {entry.glyph}
          </span>
          <div>
            <p className="integration__name">
              {SOURCE_SYSTEM_LABELS[entry.system]}
            </p>
            <p className="integration__kind">{entry.provider}</p>
          </div>
        </div>
        {statusNode}
      </div>

      <p className="action-card__rationale" style={{ marginTop: 0 }}>
        {entry.description}
      </p>

      <div className="integration__meta">
        <div className="meta-row">
          <span className="meta-row__key">Storage policy</span>
          <span className="badge badge--plain">{STORAGE_POLICY_LABELS[policy]}</span>
        </div>
        <div className="meta-row">
          <span className="meta-row__key">Last sync</span>
          <span className="meta-row__value mono">
            {connected && lastSync ? lastSync : "—"}
          </span>
        </div>
        <div className="meta-row">
          <span className="meta-row__key">Source references</span>
          <span className="meta-row__value">
            {entry.referenceReady ? "Ready" : "—"}
          </span>
        </div>
        <div className="meta-row">
          <span className="meta-row__key">Tenant scope</span>
          <span className="meta-row__value mono">isolated</span>
        </div>
      </div>

      <div className="integration__footer">
        <span className="badge">{TIER_LABELS[entry.tier]}</span>
        {/* Connect affordance: real for GitHub (when configured) + file upload;
            scaffolded for the rest. */}
        {entry.system === "github" ? (
          connected ? (
            <DisconnectButton connectionId={connection!.id} />
          ) : githubConfigured ? (
            <a className="btn btn--secondary" href="/api/oauth/github/start">
              Connect
            </a>
          ) : (
            <button
              type="button"
              className="btn btn--ghost"
              disabled
              title="Add GITHUB_OAUTH_CLIENT_ID / SECRET to enable"
            >
              Needs credentials
            </button>
          )
        ) : entry.system === "file_upload" ? (
          <a className="btn btn--secondary" href="#upload">
            Add a note
          </a>
        ) : (
          <button
            type="button"
            className="btn btn--ghost"
            disabled
            title="Direct integration designed — connection not wired in this scaffold"
          >
            Connect
          </button>
        )}
      </div>
    </article>
  );
}

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ github?: string; count?: string }>;
}) {
  const ctx = await requireTenantContext();
  const [connections, recentItems, params] = await Promise.all([
    listSourceConnections(),
    listRecentSourceItems(ctx.tenantId, 15),
    searchParams,
  ]);

  const githubConfigured = isGithubOAuthConfigured();
  const notice = githubNotice(params.github);
  const importedCount = params.count ? Number(params.count) : null;

  const connectionBySystem = new Map(connections.map((c) => [c.system, c]));

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">Sources</p>
        <h1 className="page-head__title">Connected sources</h1>
        <p className="page-head__lead">
          The channels your briefings draw on. Each source is tenant-scoped,
          carries its own storage policy, and produces traceable references.
          Direct integrations are designed and scaffolded; file upload and GitHub
          are wired today.
        </p>
      </div>

      {notice ? (
        <div
          className={`alert ${notice.ok ? "alert--ok" : "alert--warn"}`}
          style={{ marginBottom: "var(--space-lg)" }}
        >
          <div>
            <p className="alert__body">
              {notice.message}
              {notice.ok && importedCount !== null && !Number.isNaN(importedCount)
                ? ` (${importedCount} item${importedCount === 1 ? "" : "s"})`
                : ""}
            </p>
          </div>
        </div>
      ) : null}

      <div className="integration-grid">
        {SOURCE_CATALOGUE.map((entry) => (
          <IntegrationCard
            key={entry.system}
            entry={entry}
            connection={connectionBySystem.get(entry.system)}
            githubConfigured={githubConfigured}
          />
        ))}
      </div>

      {/* --- File / paste upload (wired) ----------------------------------- */}
      <section id="upload" style={{ marginTop: "var(--space-xl)" }}>
        <div className="card">
          <div className="card-head">
            <div>
              <p className="eyebrow">File &amp; paste upload</p>
              <h2 className="card__title">Add a note or document</h2>
            </div>
            <span className="badge">no credentials</span>
          </div>
          <p className="action-card__rationale" style={{ marginBottom: "var(--space-lg)" }}>
            Paste text or upload a .txt/.md file. It is normalised and stored as a
            source item your briefings can draw on and cite.
          </p>
          <UploadForm />
        </div>
      </section>

      {/* --- Recently ingested --------------------------------------------- */}
      <section style={{ marginTop: "var(--space-xl)" }}>
        <div className="card">
          <p className="eyebrow" style={{ marginBottom: "var(--space-md)" }}>
            Recently ingested
          </p>
          {recentItems.length === 0 ? (
            <div className="empty">
              <p className="empty__title">Nothing ingested yet</p>
              <p className="empty__body">
                Add a note above, or connect a source to bring in real context.
              </p>
            </div>
          ) : (
            <ul className="stack" style={{ gap: "var(--space-md)" }}>
              {recentItems.map((item) => (
                <li
                  key={item.id}
                  style={{
                    paddingBottom: "var(--space-md)",
                    borderBottom: "1px solid var(--colour-border)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: "var(--space-md)",
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>
                      {item.title ?? "Untitled"}
                    </span>
                    <span className="mono" style={{ fontSize: "var(--text-label)", color: "var(--colour-text-tertiary)" }}>
                      {SOURCE_SYSTEM_LABELS[item.system as keyof typeof SOURCE_SYSTEM_LABELS] ??
                        item.system}
                      {item.occurredAt ? ` · ${formatTimestamp(item.occurredAt)}` : ""}
                    </span>
                  </div>
                  {item.body ? (
                    <p
                      style={{
                        marginTop: "var(--space-xs)",
                        color: "var(--colour-text-secondary)",
                        fontSize: "var(--text-small)",
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {item.body}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
