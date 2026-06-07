/**
 * modules/tool-gateway — the Paylo Tool Gateway.
 * Governance: services/tool-gateway-service.md,
 * architecture/mcp-tool-architecture.md.
 *
 * The single, tenant-aware front door for MCP tool access: policy, risk
 * classification, approval, routing, server-side credential injection, output
 * sanitisation, audit, and usage. Agents/workflows call `toolGateway.invoke`;
 * they never call MCP servers directly. The Gateway routes via the MCP registry
 * (`@/modules/mcp-registry`) and never calls an unregistered/inactive tool.
 *
 * This is the module's public surface — other modules import only from here.
 *
 * Note: `RiskClass` / `DEFAULT_RISK_CLASS` are owned by `@/modules/mcp-registry`
 * (classification lives in the registry, mcp-tool-architecture.md §7) and are
 * re-exported here so they are also available from `@/modules/tool-gateway`.
 */

export type {
  AgentTaskContext,
  ApprovalToken,
  EntitlementDecision,
  ToolAuditEvent,
  ToolGatewayService,
  ToolInvocationOutcome,
  ToolInvocationRequest,
  ToolInvocationResult,
  ToolUsageRecord,
} from "./types";

export {
  effectiveRiskClass,
  evaluateApprovalGate,
  isApprovalTokenValid,
  isConsequential,
} from "./policy";

export { toolGateway } from "./service";

export { DEFAULT_RISK_CLASS, type RiskClass } from "@/modules/mcp-registry";
