/**
 * modules/mcp-registry/types.ts
 *
 * Types for the MCP Server Registry — the source of truth for which MCP servers
 * and tools exist, with the metadata the Tool Gateway needs to route safely.
 *
 * Governance:
 *   - services/mcp-server-registry-service.md (responsibilities, metadata, status)
 *   - architecture/mcp-tool-architecture.md §6 (registry/catalogue) and §7 (risk class)
 *
 * Hard rules mirrored here:
 *   - "Nothing is callable unless it is registered and active." (§6)
 *   - "An unclassified tool defaults to the most restrictive class." (§7)
 *   - No secrets live in the registry; credentials are injected server-side by
 *     the Gateway (mcp-server-registry-service.md "Security concerns").
 *
 * Scaffold note: shapes + lookup contract only; no MCP servers are built here.
 *
 * `RiskClass` / `DEFAULT_RISK_CLASS` are defined here because risk
 * classification "lives in the registry" per §7; the Tool Gateway re-exports
 * them so they are also surfaced from `@/modules/tool-gateway`.
 */

/**
 * Risk class drives the Tool Gateway approval gate
 * (mcp-tool-architecture.md §7):
 *   - read_only  — fetches/queries data, no side effects. Allowed in MVP (audited).
 *   - write      — creates/edits/sends in an external system. Post-MVP; approval-gated.
 *   - dangerous  — irreversible / high-blast-radius. Post-MVP; per-call approval.
 */
export type RiskClass = "read_only" | "write" | "dangerous";

/**
 * The most restrictive class. An unclassified tool defaults to this so a
 * misconfiguration fails safe rather than open (§7, registry "Security concerns").
 */
export const DEFAULT_RISK_CLASS: RiskClass = "dangerous";

/** MCP transport mechanism (mcp-server-registry-service.md "Responsibilities"). */
export type Transport = "stdio" | "streamable_http";

/**
 * Who owns/operates the MCP server (mcp-tool-architecture.md §5 routing targets):
 *   - paylo        — Paylo-hosted MCP server (platform-scoped).
 *   - tenant       — future tenant-owned server (tenant-scoped; RLS isolated).
 *   - third_party  — future vetted external server (platform-scoped, allowlisted).
 */
export type OwnerScope = "paylo" | "tenant" | "third_party";

/**
 * Lifecycle status (mcp-server-registry-service.md "Responsibilities"). Only
 * `active` entries are routable; `deprecated`/`experimental` are blocked from
 * normal routing by the Gateway.
 */
export type RegistryStatus = "active" | "experimental" | "deprecated";

/**
 * Pointer to a registered input/output schema (e.g. a named schema id). Schemas
 * themselves are not embedded here to keep the registry dependency-free; the
 * Gateway resolves and validates against them at invocation time.
 */
export type SchemaRef = string;

/**
 * Vetting metadata for third-party / tenant-owned servers. Such servers require
 * review + allowlisting before activation (registry "Security concerns").
 */
export interface VettingMetadata {
  readonly reviewStatus: "pending" | "approved" | "rejected";
  /** Must be true (and reviewStatus "approved") before a non-paylo server is active. */
  readonly allowlisted: boolean;
  readonly reviewedAt?: string;
}

/**
 * A single tool exposed by an MCP server. Risk class + `requiresApproval` are
 * security-critical metadata enforced by the Gateway.
 */
export interface ToolDefinition {
  /** Stable, action-oriented tool name (e.g. "calendar_read"). */
  readonly name: string;
  readonly description: string;
  /** Schema the Gateway validates arguments against before routing. */
  readonly inputSchemaRef: SchemaRef;
  /** Schema the (untrusted) output is validated against post-call. */
  readonly outputSchemaRef: SchemaRef;
  /** Classification; defaults to DEFAULT_RISK_CLASS if a registration omits it. */
  readonly riskClass: RiskClass;
  /** Whether a recorded human approval token is required to execute. */
  readonly requiresApproval: boolean;
  /** Tasks/contexts this tool supports (used by entitlement + routing). */
  readonly supportedTasks: readonly string[];
  readonly status: RegistryStatus;
}

/**
 * A registered MCP server and the tools it catalogues. The server is a runtime
 * adapter behind the Gateway; it is reached over a private, authenticated path
 * and is never tenant- or browser-facing (mcp-tool-architecture.md §14).
 */
export interface McpServer {
  readonly id: string;
  readonly name: string;
  readonly ownerScope: OwnerScope;
  readonly transport: Transport;
  /**
   * Reference to the private endpoint (id/handle), NOT a secret and NOT a public
   * URL. Credentials are injected server-side by the Gateway, not stored here.
   */
  readonly endpointRef: string;
  readonly status: RegistryStatus;
  /**
   * Owning tenant for `ownerScope: "tenant"` servers (tenant-scoped/RLS). Absent
   * for `paylo`/`third_party` (platform-scoped) servers.
   */
  readonly tenantId?: string;
  /** Required for `tenant`/`third_party` servers before activation. */
  readonly vetting?: VettingMetadata;
  readonly tools: readonly ToolDefinition[];
}

/** Result of resolving a tool name: the hosting server + the tool metadata. */
export interface RegistryToolLookup {
  readonly server: McpServer;
  readonly tool: ToolDefinition;
}

/**
 * Read-only registry lookup contract consumed by the Tool Gateway and
 * entitlement. The registry never calls MCP servers; it only describes them.
 */
export interface McpRegistryService {
  /**
   * Active servers visible to a tenant: platform-scoped (`paylo`/`third_party`)
   * servers plus that tenant's own (`tenant`) servers. Tenant-owned entries of
   * other tenants are never returned (tenant isolation).
   */
  listServers(tenantId: string): Promise<readonly McpServer[]>;

  /**
   * Resolve a tool by name within the tenant's visible, active servers. Returns
   * `null` when the tool is unknown, unregistered, or not `active` — the Gateway
   * treats `null` as "not callable".
   */
  lookupTool(
    tenantId: string,
    toolName: string,
  ): Promise<RegistryToolLookup | null>;
}
