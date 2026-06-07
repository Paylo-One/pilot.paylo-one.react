/**
 * modules/mcp-registry/registry.ts
 *
 * In-memory MCP Server Registry seed + a tenant-scoped lookup implementation.
 *
 * Governance:
 *   - services/mcp-server-registry-service.md (seed read-only servers; block
 *     deprecated/unregistered; platform vs tenant scope)
 *   - architecture/mcp-tool-architecture.md §6 (nothing callable unless
 *     registered + active), §9 (tenant isolation), §15 (MVP: read-only seed)
 *
 * Scaffold note: this is an in-memory catalogue, not a DB-backed registry.
 * Lookup/filter logic is pure and trivial, so it is implemented directly (no
 * MCP execution happens here — the registry only *describes* servers). Adding a
 * write/dangerous tool here is intentionally avoided: MVP registers read-only
 * Paylo-hosted tools only.
 */

import type {
  McpRegistryService,
  McpServer,
  RegistryToolLookup,
} from "./types";

/**
 * Seed catalogue. A single Paylo-hosted, read-only example tool, consistent
 * with the MVP rule "no autonomous external actions" (read-only context tools
 * only). Replace/extend via real registration later; agent code does not change.
 */
export const SEED_MCP_SERVERS: readonly McpServer[] = [
  {
    id: "paylo-context",
    name: "Paylo Context Tools",
    ownerScope: "paylo",
    transport: "streamable_http",
    // Private endpoint handle resolved server-side; not a secret, not public.
    endpointRef: "internal:paylo-context",
    status: "active",
    tools: [
      {
        name: "document_fetch",
        description:
          "Fetch a single document the tenant already has access to, for context gathering. No side effects.",
        inputSchemaRef: "schema:document_fetch.input.v1",
        outputSchemaRef: "schema:document_fetch.output.v1",
        riskClass: "read_only",
        requiresApproval: false,
        supportedTasks: ["briefing", "search_retrieval"],
        status: "active",
      },
    ],
  },
];

/**
 * True when a server is visible to the given tenant: platform-scoped servers
 * (`paylo`/`third_party`) are visible to all tenants; `tenant`-owned servers
 * are visible only to their owning tenant (tenant isolation, §9).
 */
function isVisibleToTenant(server: McpServer, tenantId: string): boolean {
  if (server.ownerScope === "tenant") {
    return server.tenantId === tenantId;
  }
  return true;
}

/** True only for `active` servers (deprecated/experimental are not routable). */
function isActive(server: McpServer): boolean {
  return server.status === "active";
}

/**
 * In-memory registry over {@link SEED_MCP_SERVERS}. The lookup enforces
 * "nothing callable unless registered + active" and tenant visibility; it never
 * contacts an MCP server.
 */
export const mcpRegistryService: McpRegistryService = {
  async listServers(tenantId: string): Promise<readonly McpServer[]> {
    return SEED_MCP_SERVERS.filter(
      (server) => isActive(server) && isVisibleToTenant(server, tenantId),
    );
  },

  async lookupTool(
    tenantId: string,
    toolName: string,
  ): Promise<RegistryToolLookup | null> {
    for (const server of SEED_MCP_SERVERS) {
      if (!isActive(server) || !isVisibleToTenant(server, tenantId)) {
        continue;
      }
      const tool = server.tools.find(
        (candidate) => candidate.name === toolName && candidate.status === "active",
      );
      if (tool) {
        return { server, tool };
      }
    }
    return null;
  },
};
