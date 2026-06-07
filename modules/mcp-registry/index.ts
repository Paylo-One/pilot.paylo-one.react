/**
 * modules/mcp-registry — the MCP Server Registry & tool catalogue.
 * Governance: services/mcp-server-registry-service.md,
 * architecture/mcp-tool-architecture.md §6–§7.
 *
 * Source of truth for which MCP servers/tools exist, their capabilities, risk
 * class, approval requirement, transport, owner scope, and status. Consumed by
 * the Tool Gateway (routing + risk) and entitlement. Exposes a read-only lookup
 * interface; nothing is callable unless it is registered and active.
 *
 * This is the module's public surface — other modules import only from here,
 * never from internal files (technical-design.md "Module boundary rule").
 */

export type {
  McpRegistryService,
  McpServer,
  OwnerScope,
  RegistryStatus,
  RegistryToolLookup,
  RiskClass,
  SchemaRef,
  ToolDefinition,
  Transport,
  VettingMetadata,
} from "./types";

export { DEFAULT_RISK_CLASS } from "./types";

export { mcpRegistryService, SEED_MCP_SERVERS } from "./registry";
