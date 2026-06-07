/**
 * modules/model-usage-cost — records usage, tokens, latency, cost, and status
 * for every inference call and attributes them to tenant/user/agent. Feeds
 * quotas (Model Entitlement), billing inputs, and cost-optimisation decisions
 * (which workloads to move from frontier APIs to vLLM).
 *
 * Governance:
 *  - services/model-usage-and-cost-service.md (fields, attribution, failure modes)
 *  - architecture/model-inference-architecture.md §13 (usage tracking & cost)
 *  - architecture/data-architecture.md "Token usage record" object (tenant-scoped)
 *
 * Privacy: usage records carry NO prompt/response content — only metadata +
 * counts. Recorded even on failed/partial runs where token counts are known;
 * metering must never block or break the inference path.
 *
 * MVP implementation: writes one `model_usage` row per call via the secret
 * client (service_role) with an explicit tenant_id. End users may SELECT their
 * tenant's usage (RLS) but never INSERT it, so the write is server-only.
 */

import "server-only";

import {
  AppError,
  err,
  ok,
  type Result,
  type TenantContext,
} from "@/modules/shared";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import type { RuntimeType } from "@/modules/model-catalogue";

/** Outcome of the metered call (model-usage-and-cost-service.md `status`). */
export type UsageStatus = "ok" | "failed" | "partial";

/**
 * One per-call metering record. Mirrors the `token_usage_record` object in
 * data-architecture.md. Recorded even when a run fails, provided token counts
 * are known.
 */
export interface ModelUsageRecord {
  readonly tenantId: string;
  readonly userId: string;
  readonly modelId: string;
  /** Provider/runtime family that served the call. */
  readonly provider: RuntimeType;
  /** Links the call back to the originating agent run, where one exists. */
  readonly agentRunId?: string;
  /** The `model_invocation` this metering belongs to. */
  readonly modelInvocationId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  /** Estimated cost in USD, derived from the model's cost profile. */
  readonly estimatedCostUsd: number;
  readonly latencyMs: number;
  readonly status: UsageStatus;
  readonly createdAt: string;
}

/**
 * Records per-call usage emitted by the Model Gateway. Tenant-scoped; no
 * cross-tenant aggregation is ever exposed to a tenant.
 */
export interface ModelUsageCostService {
  /**
   * Persist a single usage record. Called by the Gateway after every call,
   * including failed/partial runs where token counts are known. Metering
   * failures must be buffered/retried, never surfaced as inference failures.
   */
  record(
    ctx: TenantContext,
    usage: ModelUsageRecord,
  ): Promise<Result<{ readonly usageRecordId: string }>>;
}

export const modelUsageCostService: ModelUsageCostService = {
  async record(ctx, usage) {
    // Tenant isolation: the row is written with the context's tenant_id, never
    // a value carried on the usage payload, so metering can't cross tenants.
    const secret = createSupabaseSecretClient();
    const { data, error } = await secret
      .from("model_usage")
      .insert({
        tenant_id: ctx.tenantId,
        user_id: usage.userId || null,
        agent_run_id: usage.agentRunId ?? null,
        model: usage.modelId,
        provider: usage.provider,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        total_tokens: usage.totalTokens,
        est_cost_usd: usage.estimatedCostUsd,
        latency_ms: usage.latencyMs,
        status: usage.status,
      })
      .select("id")
      .single();
    if (error || !data) {
      return err(new AppError("internal", error?.message ?? "usage_record_failed"));
    }
    return ok({ usageRecordId: data.id as string });
  },
};
