/**
 * modules/tool-gateway/policy.ts
 *
 * Pure, side-effect-free decision helpers for the Tool Gateway. These implement
 * the trivial, data-independent parts of the documented decision flow (risk
 * classification + the approval gate) so the logic is explicit and testable.
 * Steps that require platform data (entitlement, budget) or actual MCP
 * execution are NOT here — they live in `service.ts` behind a
 * NotImplementedError boundary.
 *
 * Governance:
 *   - architecture/mcp-tool-architecture.md §7 (risk class; unclassified →
 *     most restrictive), §8 (approval-gated execution)
 *   - services/tool-gateway-service.md "Approval gating"
 */

import {
  ApprovalRequiredError,
  PolicyDeniedError,
  type Result,
  err,
  ok,
} from "@/modules/shared";
import {
  DEFAULT_RISK_CLASS,
  type RiskClass,
  type ToolDefinition,
} from "@/modules/mcp-registry";
import type { ApprovalToken } from "./types";

/**
 * Resolve the effective risk class for a tool. The registry guarantees a class,
 * but we defensively default to the most restrictive class for any tool whose
 * class is missing/unrecognised — fail safe, not open (§7).
 */
export function effectiveRiskClass(tool: ToolDefinition): RiskClass {
  const declared = tool.riskClass;
  if (
    declared === "read_only" ||
    declared === "write" ||
    declared === "dangerous"
  ) {
    return declared;
  }
  return DEFAULT_RISK_CLASS;
}

/** True for risk classes that are consequential (require human approval). */
export function isConsequential(risk: RiskClass): boolean {
  return risk === "write" || risk === "dangerous";
}

/** Ordering used to confirm an approval token covers a tool's risk class. */
const RISK_RANK: Readonly<Record<RiskClass, number>> = {
  read_only: 0,
  write: 1,
  dangerous: 2,
};

/**
 * Validate an approval token against a specific call. Pure; `now` is injected so
 * the check is deterministic and testable. A token is valid when it:
 *   - matches the tenant and tool of the call,
 *   - has not expired,
 *   - authorises a risk class at least as high as the tool's.
 */
export function isApprovalTokenValid(
  token: ApprovalToken,
  args: {
    readonly tenantId: string;
    readonly toolName: string;
    readonly riskClass: RiskClass;
    readonly now: Date;
  },
): boolean {
  if (token.tenantId !== args.tenantId) return false;
  if (token.toolName !== args.toolName) return false;
  if (RISK_RANK[token.riskClass] < RISK_RANK[args.riskClass]) return false;
  const expiresAt = Date.parse(token.expiresAt);
  if (Number.isNaN(expiresAt)) return false;
  return expiresAt > args.now.getTime();
}

/**
 * Evaluate the approval gate (§8):
 *   - read-only           → allowed (still audited downstream).
 *   - write/dangerous     → require a valid, matching approval token, else
 *                           ApprovalRequiredError; a present-but-invalid token
 *                           (wrong tenant/tool/expired/insufficient class) is a
 *                           PolicyDeniedError.
 *
 * Returns `ok(void)` when the call may proceed to routing. Never executes
 * anything itself.
 */
export function evaluateApprovalGate(args: {
  readonly riskClass: RiskClass;
  readonly tenantId: string;
  readonly toolName: string;
  readonly approvalToken?: ApprovalToken;
  readonly now: Date;
}): Result<void> {
  if (!isConsequential(args.riskClass)) {
    return ok(undefined);
  }

  const token = args.approvalToken;
  if (!token) {
    return err(
      new ApprovalRequiredError(
        `Tool "${args.toolName}" is ${args.riskClass}; a human approval token is required before execution.`,
      ),
    );
  }

  const valid = isApprovalTokenValid(token, {
    tenantId: args.tenantId,
    toolName: args.toolName,
    riskClass: args.riskClass,
    now: args.now,
  });
  if (!valid) {
    return err(
      new PolicyDeniedError(
        `Approval token is not valid for this call (tenant/tool mismatch, expired, or insufficient risk class).`,
        { toolName: args.toolName, riskClass: args.riskClass },
      ),
    );
  }

  return ok(undefined);
}
