/**
 * modules/model-gateway/service.ts — the single front door to all inference.
 * Agents, workflows, and features call `modelGateway`; they NEVER call a model
 * provider or vLLM directly. The Gateway enforces policy, assembles prompts,
 * routes to a model/runtime, validates output, and records usage + audit.
 *
 * Governance:
 *  - architecture/model-inference-architecture.md §1, §2, §5, §12
 *  - services/model-gateway-service.md (Purpose, Responsibilities, Inputs/Outputs)
 *  - architecture/security-and-privacy.md §"Model Gateway & Inference Security"
 *
 * Behaviour:
 *  - A request that supplies neither `requestedModelId` nor `modelPolicy` is a
 *    definite policy denial we can evaluate now → returns `PolicyDeniedError`
 *    via `Result` (no tokens spent).
 *  - Otherwise the call runs the live pipeline: policy/entitlement → prompt
 *    assembly → route to the OpenAI adapter → validate + meter. The default
 *    instance uses `livePipeline`; tests/alternative runtimes can inject
 *    another `GatewayPipeline` via `createModelGateway`.
 */

import {
  NotImplementedError,
  PolicyDeniedError,
  err,
  type Result,
} from "@/modules/shared";
import { livePipeline } from "./live-pipeline";
import type { GatewayPipeline } from "./pipeline";
import type {
  EmbedRequest,
  EmbedResult,
  GatewayRequest,
  GatewayResult,
  ModelPolicy,
} from "./types";

/** The public Model Gateway interface used across the app. */
export interface ModelGatewayService {
  /** Run a completion: policy → assembly → route → post-process. */
  invoke(req: GatewayRequest): Promise<Result<GatewayResult>>;
  /** Run an embedding call through the same policy/entitlement/usage path. */
  embed(req: EmbedRequest): Promise<Result<EmbedResult>>;
}

/**
 * True when a caller has specified exactly how to select a model (an explicit
 * id or a routing policy). Specifying neither is a policy denial: the Gateway
 * has nothing to route and must fail fast before any tokens are spent.
 */
function hasModelSelector(
  selector: { requestedModelId?: string; modelPolicy?: ModelPolicy },
): boolean {
  if (selector.requestedModelId) return true;
  const policy = selector.modelPolicy;
  return Boolean(
    policy && (policy.policyName || (policy.orderedModelIds?.length ?? 0) > 0),
  );
}

/** Build the Gateway service over a pipeline (defaults to the live pipeline). */
export function createModelGateway(
  pipeline: GatewayPipeline = livePipeline,
): ModelGatewayService {
  return {
    async invoke(req) {
      // Evaluable policy denial: nothing to route.
      if (!hasModelSelector(req)) {
        return err(
          new PolicyDeniedError(
            "request must specify a requestedModelId or a modelPolicy",
            { task: req.task },
          ),
        );
      }

      // Stage 1 — policy check (deny-by-default in this scaffold).
      const policy = await pipeline.policyCheck.check(req);
      if (!policy.ok) return policy;

      // Stage 2 — prompt assembly.
      const prompt = await pipeline.promptAssembly.assemble(req, policy.value);
      if (!prompt.ok) return prompt;

      // Stage 3 — route to model. Provider boundary: throws NotImplementedError.
      const routed = await pipeline.route.route(req, policy.value, prompt.value);
      if (!routed.ok) return routed;

      // Stage 4 — post-process (validate, attribute, audit, store, meter).
      return pipeline.postProcess.finalise(
        req,
        policy.value,
        prompt.value,
        routed.value,
      );
    },

    async embed(req) {
      // Same policy-before-tokens contract as completions.
      if (!hasModelSelector(req)) {
        return err(
          new PolicyDeniedError(
            "embed request must specify a requestedModelId or a modelPolicy",
            { dataClassification: req.dataClassification },
          ),
        );
      }
      // Provider boundary — no embedding adapter performs a real call yet.
      throw new NotImplementedError("model-gateway.embed (provider boundary)");
    },
  };
}

/** The default Gateway instance used across the app. */
export const modelGateway: ModelGatewayService = createModelGateway();
