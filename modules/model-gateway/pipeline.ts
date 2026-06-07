/**
 * modules/model-gateway/pipeline.ts — the Gateway's request pipeline expressed
 * as typed stage interfaces, mirroring the target flow in
 * model-inference-architecture.md §5:
 *
 *   policy check  →  prompt assembly  →  route to model  →  post-process
 *
 * Each stage is a typed contract so the orchestration is explicit and testable.
 * Stage implementations are stubs here: policy denials surface as a
 * `PolicyDeniedError` via `Result`; the provider boundary throws
 * `NotImplementedError`.
 *
 * Governance:
 *  - architecture/model-inference-architecture.md §5 (request flow), §3
 *    ("Policy before tokens"), §4 ("Provenance or it didn't happen")
 *  - services/model-gateway-service.md (Responsibilities)
 *
 * Scaffold note: interfaces + stub pipeline only.
 */

import {
  NotImplementedError,
  PolicyDeniedError,
  err,
  type Result,
} from "@/modules/shared";
import type { EntitlementDecision } from "@/modules/model-entitlement";
import type { ResolvedPrompt } from "@/modules/prompt-versioning";
import type { ModelDescriptor } from "@/modules/model-catalogue";
import type { AdapterCompletionResult } from "./adapters";
import type { GatewayRequest, GatewayResult } from "./types";

/**
 * Stage 1 — Policy check. Validates tenant, user, task/agent type, data
 * classification, model entitlement, and budget/quota BEFORE any prompt is
 * assembled or tokens are spent. A denial returns a `PolicyDeniedError`.
 */
export interface PolicyCheckOutcome {
  /** The entitlement decision that admitted the call. */
  readonly entitlement: EntitlementDecision;
  /** The model the call is permitted to use (post entitlement + catalogue check). */
  readonly admittedModel: ModelDescriptor;
}

export interface PolicyCheckStage {
  check(req: GatewayRequest): Promise<Result<PolicyCheckOutcome>>;
}

/**
 * Stage 2 — Prompt assembly. Resolves the prompt version, binds the agent
 * version, re-asserts tenant scope on retrieval context, and folds in source
 * references. Produces the system + user messages handed to the adapter.
 */
export interface AssembledPrompt {
  readonly resolved: ResolvedPrompt;
  readonly systemPrompt: string;
  readonly userPrompt: string;
}

export interface PromptAssemblyStage {
  assemble(
    req: GatewayRequest,
    policy: PolicyCheckOutcome,
  ): Promise<Result<AssembledPrompt>>;
}

/**
 * Stage 3 — Route to model. Selects the catalogue model + runtime adapter (with
 * fallback) and performs the provider/runtime call. This is the provider
 * boundary; in this scaffold it throws `NotImplementedError`.
 */
export interface RouteOutcome {
  readonly model: ModelDescriptor;
  readonly raw: AdapterCompletionResult;
}

export interface RouteStage {
  route(
    req: GatewayRequest,
    policy: PolicyCheckOutcome,
    prompt: AssembledPrompt,
  ): Promise<Result<RouteOutcome>>;
}

/**
 * Stage 4 — Post-process. Validates structured output against the requested
 * schema, attaches source references, emits the inference audit event, stores
 * the output, and records token usage/cost. Returns the final `GatewayResult`.
 */
export interface PostProcessStage {
  finalise(
    req: GatewayRequest,
    policy: PolicyCheckOutcome,
    prompt: AssembledPrompt,
    routed: RouteOutcome,
  ): Promise<Result<GatewayResult>>;
}

/** The full ordered pipeline the Gateway service drives. */
export interface GatewayPipeline {
  readonly policyCheck: PolicyCheckStage;
  readonly promptAssembly: PromptAssemblyStage;
  readonly route: RouteStage;
  readonly postProcess: PostProcessStage;
}

/**
 * Scaffold pipeline. Stage contracts are real; behaviour is stubbed:
 *  - `policyCheck` returns a `PolicyDeniedError` (deny-by-default until the
 *    entitlement/policy engine is built);
 *  - assembly/route/post-process throw `NotImplementedError`, with `route`
 *    being the explicit provider boundary.
 */
export const scaffoldPipeline: GatewayPipeline = {
  policyCheck: {
    async check() {
      // Deny-by-default: until the policy/entitlement engine exists, no call is
      // admitted. Real implementation returns an admitted model on success.
      return err(
        new PolicyDeniedError("model-gateway policy engine not implemented", {
          stage: "policy_check",
        }),
      );
    },
  },
  promptAssembly: {
    async assemble() {
      throw new NotImplementedError("model-gateway.pipeline.promptAssembly");
    },
  },
  route: {
    async route() {
      // Provider boundary — no adapter performs a real call in this scaffold.
      throw new NotImplementedError("model-gateway.pipeline.route");
    },
  },
  postProcess: {
    async finalise() {
      throw new NotImplementedError("model-gateway.pipeline.postProcess");
    },
  },
};
