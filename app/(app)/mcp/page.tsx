/**
 * Tenant Tool Layer (MCP) — system surface. Presents the tenant-scoped MCP tool
 * layer in product language, not developer jargon. Governance:
 * architecture/mcp-tool-architecture.md, services/tool-gateway-service.md,
 * services/mcp-server-registry-service.md.
 *
 * Server Component: reads the tenant-visible, active MCP servers + tools from
 * the in-memory registry (mcpRegistryService). The registry only DESCRIBES
 * servers; nothing is invoked here. Read-only tools are allowed (and audited);
 * write/dangerous tools require recorded human approval before execution.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import {
  mcpRegistryService,
  type McpServer,
  type RiskClass,
} from "@/modules/mcp-registry";

const RISK_LABELS: Record<RiskClass, { label: string; tone: string }> = {
  read_only: { label: "Read-only", tone: "ok" },
  write: { label: "Write", tone: "warn" },
  dangerous: { label: "Dangerous", tone: "risk" },
};

const OWNER_LABELS: Record<McpServer["ownerScope"], string> = {
  paylo: "Paylo-hosted",
  tenant: "Tenant-owned",
  third_party: "Third-party",
};

export default async function McpPage() {
  const ctx = await requireTenantContext();
  const servers = await mcpRegistryService.listServers(ctx.tenantId);
  const tools = servers.flatMap((server) =>
    server.tools.map((tool) => ({ server, tool })),
  );

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">Tenant Tool Layer · MCP</p>
        <h1 className="page-head__title">Tenant Tool Layer</h1>
        <p className="page-head__lead">
          Approved tenant-specific tools and resources exposed to Paylo.one
          agents through a controlled, permissioned, auditable MCP layer. Agents
          ask the gateway to run a named tool; it enforces policy, requires human
          approval for anything that changes the world, and records every call.
        </p>
      </div>

      {/* Isolation + audit markers */}
      <div
        style={{
          display: "flex",
          gap: "var(--space-sm)",
          flexWrap: "wrap",
          marginBottom: "var(--space-lg)",
        }}
      >
        <span className="status status--ok">Tenant-isolated</span>
        <span className="status status--info">Audited</span>
        <span className="status status--neutral">
          {ctx.tenantSlug}.paylo.one
        </span>
        <span className="badge">read-only · MVP</span>
      </div>

      {/* Registered tools */}
      <section style={{ marginBottom: "var(--space-xl)" }}>
        <div className="card">
          <div className="card-head">
            <div>
              <p className="eyebrow">Registered tools</p>
              <h2 className="card__title">What agents may call</h2>
            </div>
            <span className="badge">{tools.length}</span>
          </div>

          {tools.length === 0 ? (
            <div className="empty">
              <p className="empty__title">No tools registered</p>
              <p className="empty__body">
                When tools are approved for this workspace they appear here with
                their risk class and approval requirement.
              </p>
            </div>
          ) : (
            <div>
              {tools.map(({ server, tool }) => {
                const risk = RISK_LABELS[tool.riskClass];
                return (
                  <div className="tool-row" key={`${server.id}.${tool.name}`}>
                    <div className="tool-row__main">
                      <p className="tool-row__name">{tool.name}</p>
                      <p className="tool-row__desc">{tool.description}</p>
                      <div className="source-ref-row">
                        <span className="badge badge--plain">
                          {OWNER_LABELS[server.ownerScope]}
                        </span>
                        <span className="badge badge--plain">{server.name}</span>
                        <span className="badge badge--plain">
                          {tool.supportedTasks.join(", ")}
                        </span>
                      </div>
                    </div>
                    <div className="tool-row__tags">
                      <span className={`status status--${risk.tone}`}>
                        {risk.label}
                      </span>
                      <span
                        className={`status ${
                          tool.requiresApproval
                            ? "status--warn"
                            : "status--neutral"
                        }`}
                      >
                        {tool.requiresApproval ? "Approval required" : "No approval"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Registered resources */}
      <section style={{ marginBottom: "var(--space-xl)" }}>
        <div className="card">
          <div className="card-head">
            <p className="eyebrow">Registered resources</p>
            <span className="badge">future</span>
          </div>
          <div className="empty">
            <p className="empty__title">No resources exposed yet</p>
            <p className="empty__body">
              Tenant-scoped resources (documents, datasets) will surface here
              once registered, under the same permission and audit contract.
            </p>
          </div>
        </div>
      </section>

      {/* Invocation log */}
      <section style={{ marginBottom: "var(--space-xl)" }}>
        <div className="card">
          <div className="card-head">
            <p className="eyebrow">Invocation log</p>
            <span className="badge">audit</span>
          </div>
          <div className="empty">
            <p className="empty__title">No tool invocations recorded</p>
            <p className="empty__body">
              Every call — initiator, tool, server, approval reference, and
              result — is written to the tenant audit log and listed here.
            </p>
          </div>
        </div>
      </section>

      <p className="scaffold-note">
        Read-only tools are allowed and audited; write and dangerous tools are
        approval-gated and surface as suggested actions before they ever run.
        Nothing is callable unless it is registered and active. Servers and
        invocation routing are scaffolded — no MCP server is contacted in this
        build.
      </p>
    </main>
  );
}
