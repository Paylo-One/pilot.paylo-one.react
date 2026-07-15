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
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  /** Prompt provenance: which template/stored version served the call. */
  readonly promptTemplateKey?: string;
  readonly promptVersionId?: string | null;
  /** True for operator-initiated prompt test runs (still metered). */
  readonly isTest?: boolean;
  readonly createdAt: string;
}

/** Per-model roll-up within a usage summary window. */
export interface UsageModelBreakdown {
  readonly modelId: string;
  readonly calls: number;
  readonly totalTokens: number;
  readonly estCostUsd: number;
}

/**
 * Tenant-scoped roll-up of metered usage over a trailing window. Used to
 * surface spend and volume to the operator (Settings) so unit economics are
 * legible; carries counts and cost only, never prompt/response content.
 */
export interface UsageSummary {
  /** Length of the trailing window, in days. */
  readonly windowDays: number;
  /** ISO-8601 lower bound of the window (inclusive). */
  readonly since: string;
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  /** Summed estimated cost in USD across the window. */
  readonly estCostUsd: number;
  /** Calls whose status was `failed` (still metered where tokens are known). */
  readonly failedCalls: number;
  /** Per-model breakdown, ordered by estimated cost descending. */
  readonly byModel: readonly UsageModelBreakdown[];
  /**
   * True when the row cap was hit, so the figures are a lower bound over the
   * most recent calls in the window rather than the full total.
   */
  readonly truncated: boolean;
}

/** Raw `model_usage` row shape consumed by the aggregation. */
export interface RawUsageRow {
  readonly model: string | null;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly total_tokens: number | null;
  /** Postgres `numeric` is serialised as a string by PostgREST. */
  readonly est_cost_usd: number | string | null;
  readonly status: string | null;
}

/** Round to a stable 6-dp value so summed floats don't leak precision noise. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function toNumber(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Pure aggregation of raw usage rows into a {@link UsageSummary}. Extracted so
 * the cost/volume roll-up can be unit-tested without a database. Handles null
 * token columns (falls back to input+output) and string-encoded `numeric`
 * cost values.
 */
export function summarizeUsageRows(
  rows: readonly RawUsageRow[],
  meta: { readonly windowDays: number; readonly since: string; readonly truncated: boolean },
): UsageSummary {
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let estCostUsd = 0;
  let failedCalls = 0;
  const byModel = new Map<string, { calls: number; totalTokens: number; estCostUsd: number }>();

  for (const row of rows) {
    const input = toNumber(row.input_tokens);
    const output = toNumber(row.output_tokens);
    const total = row.total_tokens != null ? toNumber(row.total_tokens) : input + output;
    const cost = toNumber(row.est_cost_usd);

    calls += 1;
    inputTokens += input;
    outputTokens += output;
    totalTokens += total;
    estCostUsd += cost;
    if (row.status === "failed") failedCalls += 1;

    const key = row.model ?? "unknown";
    const bucket = byModel.get(key) ?? { calls: 0, totalTokens: 0, estCostUsd: 0 };
    bucket.calls += 1;
    bucket.totalTokens += total;
    bucket.estCostUsd += cost;
    byModel.set(key, bucket);
  }

  return {
    windowDays: meta.windowDays,
    since: meta.since,
    calls,
    inputTokens,
    outputTokens,
    totalTokens,
    estCostUsd: round6(estCostUsd),
    failedCalls,
    byModel: [...byModel.entries()]
      .map(([modelId, b]) => ({
        modelId,
        calls: b.calls,
        totalTokens: b.totalTokens,
        estCostUsd: round6(b.estCostUsd),
      }))
      .sort((a, b) => b.estCostUsd - a.estCostUsd || b.totalTokens - a.totalTokens),
    truncated: meta.truncated,
  };
}

/** Hard cap on rows pulled for a single summary (PostgREST default page size). */
export const USAGE_SUMMARY_ROW_CAP = 1000;

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

  /**
   * Tenant-scoped roll-up of usage/cost over a trailing window (default 30
   * days), for operator-facing display. Reads through the authenticated
   * (RLS-enforced) client and additionally filters on the context tenant id
   * as defence in depth. Figures are a lower bound when {@link
   * UsageSummary.truncated} is set.
   */
  summarize(
    ctx: TenantContext,
    opts?: { readonly windowDays?: number },
  ): Promise<Result<UsageSummary>>;
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
        prompt_template_key: usage.promptTemplateKey ?? null,
        prompt_version_id: usage.promptVersionId ?? null,
        is_test: usage.isTest ?? false,
      })
      .select("id")
      .single();
    if (error || !data) {
      return err(new AppError("internal", error?.message ?? "usage_record_failed"));
    }
    return ok({ usageRecordId: data.id as string });
  },

  async summarize(ctx, opts) {
    const windowDays = Math.max(1, Math.floor(opts?.windowDays ?? 30));
    const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

    // Authenticated (RLS-enforced) client; the explicit tenant predicate is
    // defence in depth on top of the `usage_select` tenant policy.
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("model_usage")
      .select("model, input_tokens, output_tokens, total_tokens, est_cost_usd, status")
      .eq("tenant_id", ctx.tenantId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(USAGE_SUMMARY_ROW_CAP);
    if (error) {
      return err(new AppError("internal", error.message));
    }
    const rows = (data ?? []) as RawUsageRow[];
    return ok(
      summarizeUsageRows(rows, {
        windowDays,
        since,
        truncated: rows.length >= USAGE_SUMMARY_ROW_CAP,
      }),
    );
  },
};
