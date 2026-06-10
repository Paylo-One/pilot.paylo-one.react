/**
 * Sources — connect/manage integrations + bring real context into the
 * workspace. Two working ingestion paths: file/paste upload (no credentials)
 * and GitHub OAuth (when configured). Every other integration is designed and
 * scaffolded, presented as a searchable, filterable card with its connection
 * contract and per-source control surface (activate, scope, storage policy,
 * Daily Memo inclusion). Governance: integration-architecture.md,
 * source-integration-strategy.md, services/source-connection.md, ingestion.md.
 *
 * Server Component: reads connections + recent items with the RLS user client,
 * derives an operator-facing SourceView per designed source, then hands the
 * list to the client browser for search / filter / configuration.
 */

import { whatsappBridgeEnabled } from "@/lib/config";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { listSourceConnections } from "@/modules/source-connection/server";
import { isGithubOAuthConfigured } from "@/modules/source-connection/github";
import { listRepositoryMonitors } from "@/modules/source-connection/github-repos";
import { listNotionResources } from "@/modules/source-connection/notion";
import { isGoogleOAuthConfigured } from "@/modules/source-connection/google";
import { listScopeItems } from "@/modules/source-connection/source-scope";
import {
  getWhatsAppSession,
  listWhatsAppMonitors,
} from "@/modules/source-connection/whatsapp-server";
import { listRecentSourceItems } from "@/modules/knowledge-store/server";
import { SOURCE_SYSTEM_LABELS } from "@/modules/source-connection";
import {
  SOURCE_DESCRIPTORS,
  deriveSourceStatus,
  isInDailyMemo,
} from "@/modules/source-connection/source-service";
import type { SourceView } from "@/modules/source-connection/source.types";
import { SourcesBrowser } from "./sources-browser";
import { UploadForm } from "./upload-form";

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

function googleNotice(
  google: string | undefined,
): { message: string; ok: boolean } | null {
  switch (google) {
    case "connected":
      return {
        message:
          "Google connected (Gmail + Calendar). Open Configure on the Email or Calendar card to choose which labels/calendars to sync — nothing is ingested until you activate one.",
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
          "GitHub connected. Open Configure on the GitHub card to choose which repositories to monitor — nothing is ingested until you activate a repository.",
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

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ github?: string; repos?: string; google?: string }>;
}) {
  const ctx = await requireTenantContext();
  const [connections, recentItems, params] = await Promise.all([
    listSourceConnections(),
    listRecentSourceItems(ctx.tenantId, 15),
    searchParams,
  ]);

  const githubConfigured = isGithubOAuthConfigured();
  const notice = githubNotice(params.github) ?? googleNotice(params.google);
  const discoveredRepos = params.repos ? Number(params.repos) : null;

  const connectionBySystem = new Map(connections.map((c) => [c.system, c]));

  // Real, persisted repository monitors for a *connected* GitHub (if any).
  const githubConnection = connectionBySystem.get("github");
  const githubRepositories =
    githubConnection && githubConnection.status === "connected"
      ? await listRepositoryMonitors(githubConnection.id)
      : [];

  // Real, persisted Notion resources for a *connected* Notion (if any).
  const notionConnection = connectionBySystem.get("notion");
  const notionResources =
    notionConnection && notionConnection.status === "connected"
      ? await listNotionResources(notionConnection.id)
      : [];

  // Google family: scope items for connected email (Gmail labels) + calendar.
  const googleConfigured = isGoogleOAuthConfigured();
  const emailConnection = connectionBySystem.get("email");
  const calendarConnection = connectionBySystem.get("calendar");
  const [emailScopeItems, calendarScopeItems] = await Promise.all([
    emailConnection && emailConnection.status === "connected"
      ? listScopeItems(emailConnection.id)
      : Promise.resolve([]),
    calendarConnection && calendarConnection.status === "connected"
      ? listScopeItems(calendarConnection.id)
      : Promise.resolve([]),
  ]);

  // WhatsApp: tenant session + approved monitors. The bridge flag decides
  // whether the card drives the real Web-session bridge or the scaffold path.
  const bridgeEnabled = whatsappBridgeEnabled();
  const whatsappSession = await getWhatsAppSession();
  const whatsappMonitors = whatsappSession
    ? await listWhatsAppMonitors(whatsappSession.id)
    : [];

  // Merge each designed source with its live connection into a serialisable
  // view for the client browser. Scope/policy stay conservative by default.
  const views: SourceView[] = SOURCE_DESCRIPTORS.map((d) => {
    const connection = connectionBySystem.get(d.system);
    const status = deriveSourceStatus(d, connection);
    const lastSync = connection ? formatTimestamp(connection.updatedAt) : "";
    return {
      system: d.system,
      name: SOURCE_SYSTEM_LABELS[d.system],
      provider: d.provider,
      glyph: d.glyph,
      description: d.description,
      category: d.category,
      status,
      mvpStatus: d.mvpStatus,
      storagePolicy: connection?.storagePolicy ?? d.defaultPolicy,
      authModel: d.authModel,
      dataPulled: d.dataPulled,
      scopeControl: d.scopeControl,
      dailyMemoUse: d.dailyMemoUse,
      riskNote: d.riskNote,
      lastSync: status === "active" && lastSync ? lastSync : null,
      referenceReady: d.referenceReady,
      inDailyMemo: isInDailyMemo(d, status),
      connect: d.connect,
      // Only a *connected* connection counts as connected in the UI. A stale
      // `disconnected`/`error` row must still surface the Connect affordance
      // (and the selector's connect prompt), not a phantom connected state.
      connectionId: connection?.status === "connected" ? connection.id : null,
      githubConfigured,
      githubRepositories: d.system === "github" ? githubRepositories : [],
      notionResources: d.system === "notion" ? notionResources : [],
      googleConfigured,
      scopeItems:
        d.system === "email"
          ? emailScopeItems
          : d.system === "calendar"
            ? calendarScopeItems
            : [],
      whatsappSession: d.system === "whatsapp" ? whatsappSession : null,
      whatsappMonitors: d.system === "whatsapp" ? whatsappMonitors : [],
      whatsappBridgeEnabled: d.system === "whatsapp" ? bridgeEnabled : false,
    };
  });

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">Sources</p>
        <h1 className="page-head__title">Connected sources</h1>
        <p className="page-head__lead">
          Choose the sources that should inform your Daily Memo. Each source is
          tenant-scoped, carries its own storage policy, and produces traceable
          references. Paylo.one only monitors what you activate and scope —
          never everything by default.
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
