/**
 * modules/tool-gateway/service.ts
 *
 * The `toolGateway` service: the single front door agents/workflows use to run
 * MCP tools. It runs the documented decision flow in typed form, returning
 * typed denials (PolicyDeniedError / ApprovalRequiredError) and throwing
 * NotImplementedError at the real MCP execution boundary (not built in scaffold).
 *
 * Governance:
 *   - architecture/mcp-tool-architecture.md §5 (tool-call flow), §6 (registry),
 *     §7 (risk), §8 (approval), §9 (tenant isolation, server-side credential
 *     injection), §10 (untrusted output), §12 (audit & usage), §15 (MVP)
 *   - services/tool-gateway-service.md (responsibilities, security, failure modes)
 *
 * Flow (mirrors §5 exactly):
 *   policy check (tenant, user, agent/task, tool + risk class, entitlement,
 *   budget) → approval gate (read-only allowed/audited; write/dangerous require
 *   human approval — no autonomous execution) → route to MCP server
 *   (tenant-scoped credentials injected server-side) → post-process (sanitise +
 *   schema-validate UNTRUSTED output, attach provenance, audit, usage record) →
 *   return (never auto-trigger another tool).
 *
 * Scaffold boundaries:
 *   - Registry resolution + risk classification + the approval gate are pure and
 *     implemented (see policy.ts).
 *   - Entitlement + budget enforcement require platform data not present in the
 *     scaffold; they are deny-by-default in production and are NOT silently
 *     "passed" here — they are part of the NotImplementedError boundary.
 *   - MCP routing, server-side credential injection, output sanitisation/
 *     validation, provenance, audit, and usage are the not-built boundary and
 *     throw NotImplementedError.
 */

import {
  NotImplementedError,
  PolicyDeniedError,
  type Result,
  err,
  isOk,
  ok,
} from "@/modules/shared";
import { mcpRegistryService } from "@/modules/mcp-registry";
import { effectiveRiskClass, evaluateApprovalGate } from "./policy";
import type {
  ToolGatewayService,
  ToolInvocationRequest,
  ToolInvocationResult,
} from "./types";

/**
 * Structural policy preconditions that are pure and data-independent: a call
 * must carry a server-trusted tenant + user and an initiating agent/task before
 * any entitlement/budget evaluation (§5 policy check ordering). A missing field
 * indicates a programming error in the caller, surfaced as a policy denial.
 */
function checkStructuralPolicy(
  request: ToolInvocationRequest,
): Result<void> {
  const { ctx, task } = request;
  if (!ctx.tenantId || !ctx.userId) {
    return err(
      new PolicyDeniedError("Missing server-trusted tenant/user context."),
    );
  }
  if (!task.agentId || !task.taskId) {
    return err(
      new PolicyDeniedError("Missing initiating agent/task context."),
    );
  }
  if (!request.toolName) {
    return err(new PolicyDeniedError("Missing tool name."));
  }
  return ok(undefined);
}

export const toolGateway: ToolGatewayService = {
  async invoke<T = unknown>(
    request: ToolInvocationRequest,
  ): Promise<Result<ToolInvocationResult<T>>> {
    const { ctx, toolName, approvalToken } = request;

    // ── Step 1: structural policy preconditions (pure) ──────────────────────
    const structural = checkStructuralPolicy(request);
    if (!isOk(structural)) {
      return structural as Result<ToolInvocationResult<T>>;
    }

    // ── Step 2: registry resolution — nothing callable unless registered +
    //            active (§6). A miss is a policy denial, not an exception.
    const lookup = await mcpRegistryService.lookupTool(ctx.tenantId, toolName);
    if (!lookup) {
      return err(
        new PolicyDeniedError(
          `Tool "${toolName}" is not registered or not active for this tenant.`,
          { toolName },
        ),
      );
    }

    // ── Step 3: risk classification (§7; unclassified → most restrictive). ──
    const riskClass = effectiveRiskClass(lookup.tool);

    // ── Step 4: entitlement + budget (§5, §11). Deny-by-default; consequential
    //            tools need both entitlement AND approval. Requires platform
    //            entitlement/budget data not present in the scaffold → part of
    //            the not-built boundary (see Step 6). Intentionally NOT a silent
    //            pass-through, so the security gap is explicit and greppable.

    // ── Step 5: approval gate (§8) — pure decision. read-only proceeds
    //            (audited later); write/dangerous require a valid approval token.
    const gate = evaluateApprovalGate({
      riskClass,
      tenantId: ctx.tenantId,
      toolName,
      approvalToken,
      now: new Date(),
    });
    if (!isOk(gate)) {
      return gate as Result<ToolInvocationResult<T>>;
    }

    // ── Step 6: route to MCP server (tenant-scoped credential injection),
    //            execute, then post-process: sanitise + schema-validate the
    //            UNTRUSTED output, attach provenance, write the tool audit event
    //            and tool-usage record, and return WITHOUT auto-triggering
    //            another tool (§5, §9, §10, §12). None of this is built in the
    //            scaffold — including entitlement/budget enforcement from Step 4.
    throw new NotImplementedError(
      `toolGateway.invoke: entitlement+budget enforcement and MCP execution ` +
        `(route to server "${lookup.server.id}", inject tenant-scoped credentials, ` +
        `sanitise+validate untrusted output, attach provenance, audit + usage) ` +
        `for tool "${toolName}" (${riskClass})`,
    );
  },
};
