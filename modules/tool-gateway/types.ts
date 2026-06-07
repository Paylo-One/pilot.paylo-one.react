/**
 * modules/tool-gateway/types.ts
 *
 * Types for the Paylo Tool Gateway — the single, tenant-aware front door for
 * MCP tool access (policy, risk classification, approval, routing, credential
 * injection, output sanitisation, audit, usage).
 *
 * Governance:
 *   - services/tool-gateway-service.md (inputs/outputs, data objects, security)
 *   - architecture/mcp-tool-architecture.md §5 (flow), §7 (risk), §8 (approval),
 *     §9 (tenant isolation), §10 (untrusted output), §12 (audit & usage)
 *
 * Key contracts mirrored here:
 *   - Agents never call MCP servers directly; they call the Gateway.
 *   - read-only allowed (audited); write/dangerous require a recorded approval
 *     token (no autonomous execution in MVP).
 *   - Tool output is untrusted data, never instructions, never auto-triggers
 *     another tool.
 *
 * Scaffold note: shapes + service contract only. `RiskClass` is owned by the
 * MCP registry (classification "lives in the registry", §7) and re-exported by
 * this module's barrel so it is also surfaced from `@/modules/tool-gateway`.
 */

import type { RiskClass } from "@/modules/mcp-registry";
import type { Result, SourceReference, TenantContext } from "@/modules/shared";

/**
 * The agent/task on whose behalf a tool runs. Tool calls are always attributed
 * to an initiating agent + task for entitlement and audit (§5 policy check).
 */
export interface AgentTaskContext {
  readonly agentId: string;
  readonly taskId: string;
}

/**
 * A recorded human approval for a consequential (write/dangerous) tool call
 * (mcp-tool-architecture.md §8). The Gateway refuses such tools without a valid
 * token; read-only tools never require one.
 */
export interface ApprovalToken {
  readonly id: string;
  /** Tenant the approval was granted within (must match the call's tenant). */
  readonly tenantId: string;
  /** Tool name the approval authorises (must match the call's tool). */
  readonly toolName: string;
  /** The operator (human) who approved. */
  readonly approvedByUserId: string;
  readonly approvedAt: string;
  /** Expiry — an expired token is invalid. ISO-8601. */
  readonly expiresAt: string;
  /** Risk class this approval authorises (must cover the tool's risk class). */
  readonly riskClass: RiskClass;
}

/**
 * A request to run a named tool. Built server-side by an agent/workflow; the
 * tenant context is server-trusted and never client-supplied
 * (tool-gateway-service.md "Inputs").
 */
export interface ToolInvocationRequest {
  /** Server-trusted tenant + user context. */
  readonly ctx: TenantContext;
  /** Initiating agent/task. */
  readonly task: AgentTaskContext;
  /** Registered tool name to invoke. */
  readonly toolName: string;
  /** Tool arguments — opaque to the Gateway; validated against the input schema. */
  readonly args: Record<string, unknown>;
  /** Schema the caller expects the (sanitised) result to conform to. */
  readonly expectedResultSchemaRef: string;
  /** Required for write/dangerous tools; omitted/ignored for read-only. */
  readonly approvalToken?: ApprovalToken;
}

/**
 * A sanitised, schema-validated tool result returned to the agent. The output
 * is strictly data (never instructions) and the Gateway never auto-triggers
 * another tool from it (§10).
 */
export interface ToolInvocationResult<T = unknown> {
  readonly invocationId: string;
  readonly toolName: string;
  readonly serverId: string;
  /** Sanitised + schema-validated payload (untrusted-origin, treated as data). */
  readonly output: T;
  /** Provenance/source reference attached where applicable (§5 post-process). */
  readonly provenance?: SourceReference;
  /** Risk class the call executed under. */
  readonly riskClass: RiskClass;
  /** Reference to the recorded tool audit event for this call. */
  readonly auditEventId: string;
}

/** Terminal outcome of a Gateway decision, recorded on the audit event. */
export type ToolInvocationOutcome =
  | "allowed"
  | "denied_policy"
  | "denied_entitlement"
  | "approval_required"
  | "succeeded"
  | "failed";

/** Whether entitlement permitted the call (deny-by-default). */
export type EntitlementDecision = "allowed" | "denied" | "not_evaluated";

/**
 * Tenant-scoped, append-only tool audit event emitted on every call — including
 * denials and approvals (mcp-tool-architecture.md §12; tool-gateway-service.md
 * "Security concerns"). Distinct from business `audit_event` and model
 * `inference_audit_event`.
 */
export interface ToolAuditEvent {
  readonly tenantId: string;
  /** Initiating user (operator). */
  readonly userId: string;
  readonly agentId: string;
  readonly taskId: string;
  readonly toolName: string;
  /** Resolved server, where the call reached routing. */
  readonly serverId?: string;
  readonly riskClass: RiskClass;
  readonly entitlementDecision: EntitlementDecision;
  /** Reference to the approval token used, for consequential tools. */
  readonly approvalTokenId?: string;
  /** Digest of arguments — never the raw args (may carry tenant/sensitive data). */
  readonly argumentsDigest: string;
  readonly outcome: ToolInvocationOutcome;
  readonly occurredAt: string;
}

/**
 * A tool-usage record capturing latency, status, and (where applicable) cost
 * (mcp-tool-architecture.md §12).
 */
export interface ToolUsageRecord {
  readonly tenantId: string;
  readonly toolName: string;
  readonly serverId?: string;
  readonly invocationId: string;
  readonly latencyMs: number;
  readonly status: "success" | "error" | "timeout";
  /** Cost in minor currency units where the tool/server has an associated cost. */
  readonly costMinorUnits?: number;
  readonly recordedAt: string;
}

/**
 * The Tool Gateway's public contract. The sole entry point agents/workflows use
 * to run tools. Expected denials (policy/entitlement/approval) are returned as
 * `Result` errors; the not-yet-built MCP execution boundary throws
 * `NotImplementedError`.
 */
export interface ToolGatewayService {
  /**
   * Run the documented decision flow:
   *   policy check → approval gate → route to MCP server (tenant-scoped
   *   credential injection) → sanitise/validate output + provenance → audit +
   *   usage → return (never auto-trigger another tool).
   *
   * @returns ok(result) on success; err(PolicyDeniedError) /
   *   err(ApprovalRequiredError) / err(AppError) on an expected denial.
   * @throws NotImplementedError at the actual MCP execution boundary (scaffold).
   */
  invoke<T = unknown>(
    request: ToolInvocationRequest,
  ): Promise<Result<ToolInvocationResult<T>>>;
}
