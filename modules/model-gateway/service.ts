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
  randomUUID,
} from "node:crypto";

import {
  AppError,
  PolicyDeniedError,
  err,
  ok,
  type Result,
} from "@/modules/shared";
import { modelUsageCostService } from "@/modules/model-usage-cost";
import { resolveResponseLanguage } from "@/lib/i18n/ai-language";
import { llmEmbeddingModel } from "@/lib/llm";
import { getAdapter } from "./adapters";
import { livePipeline } from "./live-pipeline";
import type { GatewayPipeline } from "./pipeline";
import type {
  EmbedRequest,
  EmbedResult,
  GatewayRequest,
  GatewayResult,
  ModelPolicy,
} from "./types";

export const DEFAULT_EMBEDDING_MODEL_ID = "text-embedding-3-small";

/**
 * Per-1k-token input cost (USD) for the default embedding model
 * (`text-embedding-3-small`: $0.00002 / 1k tokens). Embeddings have no output
 * tokens, so only the input rate applies. Kept here rather than in the Model
 * Catalogue because the MVP catalogue lists only routable chat models; the
 * embedding runtime is reached directly. Rounded to the `model_usage`
 * numeric(10,5) scale on write.
 */
export const EMBEDDING_INPUT_COST_PER_1K_USD = 0.00002;

/** Estimate the USD cost of an embedding call from its input token count. */
export function estimateEmbeddingCostUsd(inputTokens: number): number {
  const cost = (inputTokens / 1000) * EMBEDDING_INPUT_COST_PER_1K_USD;
  // Keep within the model_usage numeric(10,5) scale.
  return Math.round(cost * 1e5) / 1e5;
}

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
    async invoke(rawReq) {
      // Language boundary (ADR-052): every Gateway call inherits the user's
      // chosen language here, so no individual caller has to remember to pass
      // it. A caller may still set `responseLanguage` explicitly (e.g. a test).
      // Background/cron runs without a request context resolve to undefined and
      // fall back to English. The value is a validated English endonym, never
      // raw input (see lib/i18n/ai-language.ts).
      const req: GatewayRequest =
        rawReq.responseLanguage === undefined
          ? { ...rawReq, responseLanguage: await resolveResponseLanguage() }
          : rawReq;

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
      const modelId =
        req.requestedModelId ??
        req.modelPolicy?.orderedModelIds?.[0] ??
        llmEmbeddingModel();
      const modelInvocationId = randomUUID();
      const adapter = getAdapter("openai");
      try {
        const raw = await adapter.embed({ modelId, inputs: req.inputs });
        try {
          await modelUsageCostService.record(req.ctx, {
            tenantId: req.ctx.tenantId,
            userId: req.ctx.userId,
            modelId,
            provider: "openai",
            agentRunId: req.agentRunId,
            modelInvocationId,
            inputTokens: raw.inputTokens,
            outputTokens: 0,
            totalTokens: raw.inputTokens,
            estimatedCostUsd: estimateEmbeddingCostUsd(raw.inputTokens),
            latencyMs: raw.latencyMs,
            status: "ok",
            promptTemplateKey: "semantic-linking-embeddings",
            createdAt: new Date().toISOString(),
          });
        } catch {
          /* metering failure is swallowed; embedding outcome stands */
        }
        return ok({ modelInvocationId, modelId, embeddings: raw.embeddings });
      } catch (cause) {
        return err(
          cause instanceof Error
            ? new AppError("internal", cause.message, { dataClassification: req.dataClassification })
            : new AppError("internal", "embedding request failed", { dataClassification: req.dataClassification }),
        );
      }
    },
  };
}

/** The default Gateway instance used across the app. */
export const modelGateway: ModelGatewayService = createModelGateway();
