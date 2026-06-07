/**
 * Sources — connect/manage integrations + bring real context into the
 * workspace. Two working ingestion paths: file/paste upload (no credentials)
 * and GitHub OAuth (when configured). Governance: integration-architecture.md,
 * services/source-connection.md, ingestion.md, normalisation.md.
 *
 * Server Component: reads connections + recent items with the RLS user client.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import { listSourceConnections } from "@/modules/source-connection/server";
import { SOURCE_SYSTEM_LABELS } from "@/modules/source-connection";
import { isGithubOAuthConfigured } from "@/modules/source-connection/github";
import { listRecentSourceItems } from "@/modules/knowledge-store/server";
import { UploadForm } from "./upload-form";
import { DisconnectButton } from "./disconnect-button";

const sectionTitle: React.CSSProperties = {
  fontSize: "var(--text-h2)",
  margin: "0 0 var(--space-md)",
};

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

function githubNotice(github: string | undefined): { message: string; ok: boolean } | null {
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

  return (
    <main className="app-main">
      <p className="eyebrow">Sources</p>
      <h1 style={{ fontSize: "var(--text-h2)", margin: "8px 0 16px" }}>
        Connected sources
      </h1>

      {notice ? (
        <div
          className="panel"
          style={{
            marginBottom: "var(--space-lg)",
            borderColor: notice.ok ? "var(--colour-accent)" : "var(--colour-border-strong)",
          }}
        >
          <p style={{ fontSize: "var(--text-small)" }}>
            {notice.message}
            {notice.ok && importedCount !== null && !Number.isNaN(importedCount)
              ? ` (${importedCount} item${importedCount === 1 ? "" : "s"})`
              : ""}
          </p>
        </div>
      ) : null}

      {/* --- Connections ---------------------------------------------------- */}
      <section style={{ marginBottom: "var(--space-xl)" }}>
        <div className="panel">
          <h2 style={sectionTitle}>Your sources</h2>
          {connections.length === 0 ? (
            <p style={{ color: "var(--colour-text-secondary)", fontSize: "var(--text-small)" }}>
              No sources yet. Add a note below, or connect GitHub to bring in
              real activity.
            </p>
          ) : (
            <ul style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              {connections.map((connection) => (
                <li
                  key={connection.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "var(--space-md)",
                    padding: "var(--space-sm) 0",
                    borderBottom: "1px solid var(--colour-border)",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>
                    {connection.displayName}
                    <span
                      className="mono"
                      style={{
                        marginLeft: "var(--space-sm)",
                        fontSize: "var(--text-label)",
                        color: "var(--colour-text-tertiary)",
                      }}
                    >
                      {SOURCE_SYSTEM_LABELS[connection.system] ?? connection.system}
                    </span>
                  </span>
                  <span style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
                    <span className="badge">{connection.storagePolicy.replace(/_/g, " ")}</span>
                    <span className="badge">{connection.status}</span>
                    {connection.status === "connected" && connection.system !== "file_upload" ? (
                      <DisconnectButton connectionId={connection.id} />
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* --- File / paste upload ------------------------------------------- */}
      <section style={{ marginBottom: "var(--space-xl)" }}>
        <div className="panel">
          <h2 style={sectionTitle}>Add a note or document</h2>
          <p
            style={{
              color: "var(--colour-text-secondary)",
              fontSize: "var(--text-small)",
              marginBottom: "var(--space-lg)",
            }}
          >
            Paste text or upload a .txt/.md file. It is normalised and stored as
            a source item your briefings can draw on.
          </p>
          <UploadForm />
        </div>
      </section>

      {/* --- GitHub --------------------------------------------------------- */}
      <section style={{ marginBottom: "var(--space-xl)" }}>
        <div className="panel">
          <h2 style={sectionTitle}>GitHub</h2>
          {githubConfigured ? (
            <>
              <p
                style={{
                  color: "var(--colour-text-secondary)",
                  fontSize: "var(--text-small)",
                  marginBottom: "var(--space-md)",
                }}
              >
                Authorise read-only access to import a recent slice of your
                GitHub activity.
              </p>
              <a
                href="/api/oauth/github/start"
                style={{
                  display: "inline-block",
                  padding: "8px 20px",
                  fontSize: "var(--text-small)",
                  fontWeight: 600,
                  color: "var(--colour-text-inverse)",
                  background: "var(--colour-surface-command)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                Connect GitHub
              </a>
            </>
          ) : (
            <p className="scaffold-note">
              Add GitHub OAuth credentials (GITHUB_OAUTH_CLIENT_ID /
              GITHUB_OAUTH_CLIENT_SECRET) to enable. File &amp; paste upload above
              works without any credentials.
            </p>
          )}
        </div>
      </section>

      {/* --- Recent items --------------------------------------------------- */}
      <section>
        <div className="panel">
          <h2 style={sectionTitle}>Recently ingested</h2>
          {recentItems.length === 0 ? (
            <p style={{ color: "var(--colour-text-secondary)", fontSize: "var(--text-small)" }}>
              Nothing ingested yet.
            </p>
          ) : (
            <ul style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
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
                    <span style={{ fontWeight: 600 }}>{item.title ?? "Untitled"}</span>
                    <span
                      className="mono"
                      style={{ fontSize: "var(--text-label)", color: "var(--colour-text-tertiary)" }}
                    >
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
