/**
 * Sources — the catalogue of everything the workspace can connect to. Each
 * source appears as a quiet card (name, description, category, status, one
 * action); all setup and adaptor-specific configuration lives on the dedicated
 * /sources/<system> detail view. Governance: integration-architecture.md,
 * source-integration-strategy.md, services/source-connection.md, ingestion.md.
 *
 * Server Component: derives the SourceView list (shared with the detail pages
 * via source-views.ts) and the recently-ingested feed, then hands the
 * catalogue to the client browser for search/filter.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import { listRecentSourceItems } from "@/modules/knowledge-store/server";
import { SOURCE_SYSTEM_LABELS } from "@/modules/source-connection";
import { SourcesBrowser } from "./sources-browser";
import { buildSourceViews, formatTimestamp } from "./source-views";

function googleNotice(
  google: string | undefined,
): { message: string; ok: boolean } | null {
  switch (google) {
    case "connected":
      return {
        message:
          "Google connected (Gmail + Calendar). Open the Email or Calendar source to choose which labels/calendars to sync — nothing is synced until you activate one.",
        ok: true,
      };
    case "unconfigured":
      return { message: "Google OAuth is not configured.", ok: false };
    case "error":
      return { message: "Google connection failed. Please try again.", ok: false };
    case "denied":
      return { message: "Google authorisation was cancelled.", ok: false };
    default:
      return null;
  }
}

function githubNotice(
  github: string | undefined,
): { message: string; ok: boolean } | null {
  switch (github) {
    case "connected":
      return {
        message:
          "GitHub connected. Open the GitHub source to choose which repositories to monitor — nothing is synced until you activate a repository.",
        ok: true,
      };
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

function slackNotice(
  slack: string | undefined,
): { message: string; ok: boolean } | null {
  switch (slack) {
    case "connected":
      return {
        message:
          "Slack connected. Open the Slack source to choose which public channels to monitor — nothing is synced until you activate a channel.",
        ok: true,
      };
    case "unconfigured":
      return { message: "Slack OAuth is not configured.", ok: false };
    case "error":
      return { message: "Slack connection failed. Please try again.", ok: false };
    case "denied":
      return { message: "Slack authorisation was cancelled.", ok: false };
    default:
      return null;
  }
}

function discordNotice(
  discord: string | undefined,
): { message: string; ok: boolean } | null {
  switch (discord) {
    case "connected":
      return {
        message:
          "Discord connected. Open the Discord source to choose which server channels to monitor — nothing is synced until you activate a channel.",
        ok: true,
      };
    case "unconfigured":
      return { message: "Discord OAuth/bot credentials are not configured.", ok: false };
    case "error":
      return { message: "Discord connection failed. Please try again.", ok: false };
    case "denied":
      return { message: "Discord authorisation was cancelled.", ok: false };
    default:
      return null;
  }
}

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{
    github?: string;
    repos?: string;
    google?: string;
    slack?: string;
    discord?: string;
  }>;
}) {
  const ctx = await requireTenantContext();
  const [views, recentItems, params] = await Promise.all([
    buildSourceViews(ctx),
    listRecentSourceItems(ctx.tenantId, 15),
    searchParams,
  ]);

  const notice =
    githubNotice(params.github) ??
    googleNotice(params.google) ??
    slackNotice(params.slack) ??
    discordNotice(params.discord);
  const discoveredRepos = params.repos ? Number(params.repos) : null;

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">Sources</p>
        <h1 className="page-head__title">Connected sources</h1>
        <p className="page-head__lead">
          Choose the sources that should inform your daily briefing. Each source is
          private to your workspace, keeps its own storage rules, and every point
          it produces stays traceable to where it came from. Paylo.one only
          watches what you turn on — never everything by default.
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
              {notice.ok && discoveredRepos !== null && !Number.isNaN(discoveredRepos)
                ? ` (${discoveredRepos} repositor${discoveredRepos === 1 ? "y" : "ies"} found)`
                : ""}
            </p>
          </div>
        </div>
      ) : null}

      <SourcesBrowser views={views} />

      {/* --- Recently synced --------------------------------------------- */}
      <section style={{ marginTop: "var(--space-xl)" }}>
        <div className="card">
          <p className="eyebrow" style={{ marginBottom: "var(--space-md)" }}>
            Recently synced
          </p>
          {recentItems.length === 0 ? (
            <div className="empty">
              <p className="empty__title">Nothing synced yet</p>
              <p className="empty__body">
                Connect a source above to bring in real context, or add a note
                via the Local uploads source.
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
