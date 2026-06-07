/**
 * modules/model-entitlement — controls which tenants/users may use which
 * models, for which tasks, under which limits. The Model Gateway consults this
 * on EVERY call so access, tiers, data-classification gating, and usage caps
 * are enforced before any tokens are spent.
 *
 * Governance:
 *  - services/model-entitlement-service.md (fields, deny-by-default, limits)
 *  - architecture/model-inference-architecture.md §9 (entitlement governs
 *    allowed models, allowed tasks per model, allowed data classifications,
 *    daily/monthly token limits, requires_human_review)
 *  - architecture/data-architecture.md "Model entitlement" object (tenant-scoped)
 *
 * Core rule: DENY BY DEFAULT. No entitlement → no access. Decisions are made
 * server-side only; client-supplied entitlement is never trusted.
 *
 * MVP implementation: a single permissive default entitlement — every tenant
 * may use the catalogued hosted model for any supported task and data class,
 * under generous token ceilings, with no human-review gate. The check still
 * runs on EVERY call so tightening to per-tenant rows (and real limit
 * enforcement) later is a data change, not a code change for callers.
 */

import {
  ok,
  type Result,
  type TenantContext,
} from "@/modules/shared";
import type { ModelTask } from "@/modules/model-catalogue";
// Type-only import (erased at compile time → no runtime cycle with the gateway).
import type { DataClassification } from "@/modules/model-gateway";

/**
 * A stored entitlement row for a tenant (optionally a specific user) + model.
 * Mirrors the `model_entitlement` object in data-architecture.md.
 */
export interface ModelEntitlement {
  readonly tenantId: string;
  /** Optional per-user scoping; absent means tenant-wide. */
  readonly userId?: string;
  readonly modelId: string;
  /** Tasks this entitlement permits for the model. */
  readonly allowedTasks: readonly ModelTask[];
  readonly enabled: boolean;
  readonly monthlyTokenLimit: number;
  readonly dailyTokenLimit: number;
  /** Data classifications this entitlement permits to reach the model. */
  readonly dataClassificationAllowed: readonly DataClassification[];
  /** Whether outputs of this task require human review before use. */
  readonly requiresHumanReview: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What the Gateway asks of the entitlement service on each call. */
export interface EntitlementRequest {
  readonly modelId: string;
  readonly task: ModelTask;
  readonly dataClassification: DataClassification;
  /** Best-effort projected token spend, for limit checks before spending. */
  readonly projectedTokens?: number;
}

/** Effective limits returned alongside an allow decision. */
export interface EffectiveLimits {
  readonly dailyTokenLimit: number;
  readonly monthlyTokenLimit: number;
}

/**
 * The allow/deny decision for one call. On deny, `reason` is actionable and the
 * call fails fast before any tokens are spent (model-entitlement-service.md
 * Failure modes).
 */
export interface EntitlementDecision {
  readonly allowed: boolean;
  /** Stable, actionable reason (e.g. "model_not_entitled", "daily_limit_exhausted"). */
  readonly reason: string;
  /** Present when allowed. */
  readonly effectiveLimits?: EffectiveLimits;
  /** Whether the task requires human review of the output. */
  readonly requiresHumanReview: boolean;
}

/**
 * Deny-by-default entitlement checks. Tenant-scoped via the supplied context;
 * one tenant can never see or affect another's entitlements.
 */
export interface ModelEntitlementService {
  /**
   * Decide whether `ctx` may use `req.modelId` for `req.task` with
   * `req.dataClassification` under current limits. Deny-by-default: a missing
   * entitlement yields `{ allowed: false }`.
   */
  check(
    ctx: TenantContext,
    req: EntitlementRequest,
  ): Promise<Result<EntitlementDecision>>;
}

/** Generous MVP ceilings; real per-tenant limits land with the entitlement table. */
const DEFAULT_DAILY_TOKEN_LIMIT = 2_000_000;
const DEFAULT_MONTHLY_TOKEN_LIMIT = 50_000_000;

export const modelEntitlementService: ModelEntitlementService = {
  async check(_ctx, _req) {
    // Allow-by-default for MVP. The decision is centralised here so deny-by-
    // default and per-tenant limits can be introduced without touching callers.
    return ok({
      allowed: true,
      reason: "allowed_by_default",
      effectiveLimits: {
        dailyTokenLimit: DEFAULT_DAILY_TOKEN_LIMIT,
        monthlyTokenLimit: DEFAULT_MONTHLY_TOKEN_LIMIT,
      },
      requiresHumanReview: false,
    });
  },
};
