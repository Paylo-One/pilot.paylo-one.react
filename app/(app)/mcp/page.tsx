import { requireTenantContext } from "@/modules/identity-tenant/server";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { appHostBaseUrl } from "@/lib/config";
import { ALL_MCP_SCOPES, MCP_SCOPES, listMcpGrants } from "@/modules/mcp";
import { revokeMcpGrantAction } from "./actions";

export const metadata = {
  title: "Tool Layer · Pilot",
};

function formatDate(value: string | null) {
  if (!value) return "Not used yet";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function recentAuditEvents(tenantId: string, userId: string) {
  const secret = createSupabaseSecretClient();
  const { data } = await secret
    .from("mcp_audit_events")
    .select("id, event_type, client_id, tool_name, status, created_at")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(8);
  return data ?? [];
}

export default async function ToolLayerPage() {
  const ctx = await requireTenantContext();
  const [grants, auditEvents] = await Promise.all([
    listMcpGrants(ctx),
    recentAuditEvents(ctx.tenantId, ctx.userId),
  ]);
  const activeGrants = grants.filter((grant) => grant.status === "active");
  const issuer = appHostBaseUrl();

  return (
    <main className="workspace__content">
      <div className="page-head">
        <div className="page-head__row">
          <div>
            <p className="eyebrow">Tool Layer</p>
            <h1 className="page-head__title">MCP Access</h1>
            <p className="page-head__lead">
              Approved clients can ask Pilot for structured workspace context:
              what changed, which actions are open, what sources support an
              answer, and what deserves attention next.
            </p>
          </div>
          <span className="status status--ok">Available</span>
        </div>
      </div>

      <section className="card" style={{ maxWidth: "920px" }}>
        <div className="card-head">
          <div>
            <p className="eyebrow">Connected clients</p>
            <h2 className="card__title">Who can use your workspace memory</h2>
          </div>
          <span className="status status--info">
            {activeGrants.length} active
          </span>
        </div>

        {grants.length === 0 ? (
          <p className="action-card__rationale">
            No MCP clients are connected yet. When a client asks for access, you
            will see exactly what it wants to read or write before anything is
            granted.
          </p>
        ) : (
          <div className="stack" style={{ gap: "var(--space-md)" }}>
            {grants.map((grant) => (
              <div className="meta-row" key={grant.id}>
                <span className="meta-row__key" style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600 }}>
                    {grant.client.name}
                  </span>
                  <span className="mono" style={{ display: "block", marginTop: "var(--space-xs)" }}>
                    Last used: {formatDate(grant.lastUsedAt)}
                  </span>
                </span>
                <span
                  className="meta-row__value"
                  style={{
                    display: "flex",
                    gap: "var(--space-sm)",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    flexWrap: "wrap",
                  }}
                >
                  <span className={`status status--${grant.status === "active" ? "ok" : "warn"}`}>
                    {grant.status}
                  </span>
                  <span className="badge badge--plain">
                    {grant.scopes.length} scopes
                  </span>
                  {grant.status === "active" ? (
                    <form action={revokeMcpGrantAction}>
                      <input type="hidden" name="grantId" value={grant.id} />
                      <button type="submit" className="btn btn--ghost btn--sm">
                        Revoke Access
                      </button>
                    </form>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card" style={{ maxWidth: "920px", marginTop: "var(--space-md)" }}>
        <div className="card-head">
          <div>
            <p className="eyebrow">Scope model</p>
            <h2 className="card__title">What a client can ask for</h2>
          </div>
        </div>
        <div className="stack" style={{ gap: "var(--space-sm)" }}>
          {ALL_MCP_SCOPES.map((scope) => (
            <div className="meta-row" key={scope}>
              <span className="meta-row__key mono">{scope}</span>
              <span className="meta-row__value">{MCP_SCOPES[scope]}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card" style={{ maxWidth: "920px", marginTop: "var(--space-md)" }}>
        <div className="card-head">
          <div>
            <p className="eyebrow">Audit trail</p>
            <h2 className="card__title">Recent MCP activity</h2>
          </div>
        </div>
        {auditEvents.length === 0 ? (
          <p className="action-card__rationale">
            No MCP activity has been recorded yet. Authorisations, revocations,
            and tool calls appear here without logging private memory content.
          </p>
        ) : (
          <div className="stack" style={{ gap: "var(--space-sm)" }}>
            {auditEvents.map((event: any) => (
              <div className="meta-row" key={event.id}>
                <span className="meta-row__key">
                  {event.tool_name ?? event.event_type}
                </span>
                <span className="meta-row__value">
                  <span className="badge badge--plain">{event.status}</span>{" "}
                  <span className="mono">{formatDate(event.created_at)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card" style={{ maxWidth: "920px", marginTop: "var(--space-md)" }}>
        <div className="card-head">
          <div>
            <p className="eyebrow">Client setup</p>
            <h2 className="card__title">Connect an MCP client</h2>
          </div>
        </div>
        <p className="action-card__rationale">
          Use these details in a client that supports remote MCP servers with
          OAuth. The client will open Pilot for approval, ask you to choose a
          workspace, then receive a scoped token for that workspace only.
        </p>
        <div className="stack" style={{ gap: "var(--space-sm)", marginTop: "var(--space-md)" }}>
          <div className="meta-row">
            <span className="meta-row__key">1. Add server URL</span>
            <span className="meta-row__value mono">{issuer}/api/mcp</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">2. Use OAuth discovery</span>
            <span className="meta-row__value mono">
              {issuer}/.well-known/oauth-authorization-server
            </span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">3. Sign in and approve</span>
            <span className="meta-row__value">
              Pick the workspace, review the requested scopes, then allow
              access.
            </span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">4. Review access here</span>
            <span className="meta-row__value">
              Connected clients appear above with last-used time, scopes, audit
              events, and revoke controls.
            </span>
          </div>
        </div>
      </section>

      <section className="card" style={{ maxWidth: "920px", marginTop: "var(--space-md)" }}>
        <div className="card-head">
          <div>
            <p className="eyebrow">Technical details</p>
            <h2 className="card__title">OAuth endpoints</h2>
          </div>
        </div>
        <p className="action-card__rationale">
          Approved clients use OAuth with PKCE and short-lived bearer tokens.
          Public clients never receive a shared secret.
        </p>
        <div className="stack" style={{ gap: "var(--space-sm)", marginTop: "var(--space-md)" }}>
          <div className="meta-row">
            <span className="meta-row__key">Issuer</span>
            <span className="meta-row__value mono">{issuer}</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">MCP endpoint</span>
            <span className="meta-row__value mono">{issuer}/api/mcp</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Metadata</span>
            <span className="meta-row__value mono">
              {issuer}/.well-known/oauth-authorization-server
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
