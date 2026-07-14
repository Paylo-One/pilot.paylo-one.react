import "server-only";

/**
 * modules/model-gateway/live-pipeline.ts — the real (MVP) implementation of the
 * Gateway's four-stage pipeline (model-inference-architecture.md §5):
 *
 *   policy check → prompt assembly → route to model → post-process
 *
 * It wires the sibling services together behind the same `GatewayPipeline`
 * contract the scaffold pipeline used, so the Gateway service orchestration is
 * unchanged:
 *  - policy check  → Model Catalogue (routable model) + Model Entitlement
 *                    (allow-by-default in MVP, deny fails fast before tokens);
 *  - assembly      → Prompt Versioning (system instruction) + tenant-filtered
 *                    retrieval context folded into the user message;
 *  - route         → the runtime adapter for the admitted model (real OpenAI);
 *  - post-process  → structured-output validation (zod, JSON object) + a
 *                    `model_usage` metering row (never breaks the call).
 *
 * Server-only: the route + post-process stages reach the provider and the
 * secret-client metering write.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AppError,
  PolicyDeniedError,
  ValidationError,
  err,
  ok,
  type Result,
} from "@/modules/shared";
import { modelCatalogueService, defaultOpenAiModelId } from "@/modules/model-catalogue";
import type { ModelDescriptor } from "@/modules/model-catalogue";
import { modelEntitlementService } from "@/modules/model-entitlement";
import {
  getActiveModelProviderWithKey,
  tenantModelToDescriptor,
} from "@/modules/tenant-models/server";
import { promptVersioningService } from "@/modules/prompt-versioning/server";
import { languageDirective } from "@/lib/i18n/ai-language";
import { modelUsageCostService, type UsageStatus } from "@/modules/model-usage-cost";
import { getAdapter, type AdapterRuntimeType } from "./adapters";
import type {
  AssembledPrompt,
  GatewayPipeline,
  PolicyCheckOutcome,
  RouteOutcome,
} from "./pipeline";
import type { RetrievalContextItem } from "./types";

/** True for runtimes that have a first-class adapter (everything but `custom`). */
function isAdapterRuntime(runtime: ModelDescriptor["runtimeType"]): runtime is AdapterRuntimeType {
  return runtime !== "custom";
}

/** Fold tenant-filtered retrieval context into the user message. */
function buildUserPrompt(items: readonly RetrievalContextItem[]): string {
  if (items.length === 0) {
    return "No recent items were supplied. Produce a brief, honest 'quiet day' memo without inventing anything.";
  }
  const lines = items.map((item) => `[${item.sourceItemId}] ${item.occurredAt}\n${item.summary}`);
  return [
    "Recent items from the operator's connected channels.",
    "Reference items by their id token (e.g. item-1) in every sourceItemIds array.",
    "",
    lines.join("\n\n"),
  ].join("\n");
}

/** Estimate USD cost from the model's per-1k cost profile. */
function estimateCost(model: ModelDescriptor, inputTokens: number, outputTokens: number): number {
  const cost =
    (inputTokens / 1000) * model.costProfile.inputPer1kUsd +
    (outputTokens / 1000) * model.costProfile.outputPer1kUsd;
  // Keep within the model_usage numeric(10,5) scale.
  return Math.round(cost * 1e5) / 1e5;
}

/** Parse + validate the adapter output as a JSON object (structured output). */
function parseJsonObject(content: string): Result<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return err(new ValidationError("model output was not valid JSON"));
  }
  const schema = z.record(z.string(), z.unknown());
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return err(
      new ValidationError("model output was not a JSON object", {
        issues: result.error.issues,
      }),
    );
  }
  return ok(result.data);
}

export const livePipeline: GatewayPipeline = {
  policyCheck: {
    async check(req): Promise<Result<PolicyCheckOutcome>> {
      // BYO key (ADR-038): unless the caller pinned an explicit model, route the
      // completion through the tenant's active, verified provider when one is set
      // and it supports this task. The key is fetched again at the route stage —
      // never carried in the (loggable) policy outcome.
      let admittedModel: ModelDescriptor | null = null;
      if (!req.requestedModelId) {
        try {
          const byo = await getActiveModelProviderWithKey(req.ctx);
          if (byo) {
            const descriptor = tenantModelToDescriptor(byo.provider, byo.modelId);
            if (descriptor.supportedTasks.includes(req.task)) admittedModel = descriptor;
          }
        } catch (cause) {
          // A BYO-lookup failure (e.g. table missing pre-migration, transient DB
          // error) must never break inference — fall through to the platform
          // default, exactly as prompt resolution does.
          console.warn(
            "[model-gateway] BYO provider lookup failed; using platform default:",
            cause instanceof Error ? cause.message : cause,
          );
        }
      }

      // Otherwise resolve a platform model (catalogue-driven; nothing routes to
      // an uncatalogued/inactive model). Explicit id wins; else the policy's
      // first ordered candidate; else the default hosted model.
      if (!admittedModel) {
        const targetId =
          req.requestedModelId ??
          req.modelPolicy?.orderedModelIds?.[0] ??
          defaultOpenAiModelId();
        const modelRes = await modelCatalogueService.assertRoutable(targetId, req.ctx);
        if (!modelRes.ok) return modelRes;
        admittedModel = modelRes.value;
      }

      // Entitlement is consulted on every call (allow-by-default in MVP).
      const entitlementRes = await modelEntitlementService.check(req.ctx, {
        modelId: admittedModel.modelId,
        task: req.task,
        dataClassification: req.dataClassification,
      });
      if (!entitlementRes.ok) return entitlementRes;
      if (!entitlementRes.value.allowed) {
        return err(
          new PolicyDeniedError("entitlement denied", {
            reason: entitlementRes.value.reason,
            modelId: admittedModel.modelId,
            task: req.task,
          }),
        );
      }

      return ok({ entitlement: entitlementRes.value, admittedModel });
    },
  },

  promptAssembly: {
    async assemble(req): Promise<Result<AssembledPrompt>> {
      const resolvedRes = await promptVersioningService.resolve(req.ctx, {
        promptTemplateId: req.promptTemplateId,
        promptVersion: req.promptVersion,
        promptVersionId: req.promptVersionId,
      });
      if (!resolvedRes.ok) return resolvedRes;
      const resolved = resolvedRes.value;

      // Append the user's language directive (ADR-052). It is a static,
      // tenant-agnostic sentence added AFTER the tenant system prompt, so it
      // cannot override safety/role instructions and carries no tenant data.
      const systemPrompt = req.responseLanguage
        ? resolved.version.systemPrompt + languageDirective(req.responseLanguage)
        : resolved.version.systemPrompt;

      return ok({
        resolved,
        systemPrompt,
        userPrompt: buildUserPrompt(req.retrievalContext),
      });
    },
  },

  route: {
    async route(req, policy, prompt): Promise<Result<RouteOutcome>> {
      const model = policy.admittedModel;
      if (!isAdapterRuntime(model.runtimeType)) {
        return err(new AppError("internal", `no adapter for runtime ${model.runtimeType}`));
      }

      // Tenant-owned (BYO) model → use the tenant's key (server-only, fetched
      // here so it never travels through the policy outcome). Platform models
      // leave apiKey undefined and the adapter uses the Paylo server env key.
      let apiKey: string | undefined;
      if (model.ownerType === "tenant") {
        const byo = await getActiveModelProviderWithKey(req.ctx);
        if (!byo || byo.modelId !== model.modelId) {
          return err(new AppError("internal", "tenant model key is no longer available"));
        }
        apiKey = byo.apiKey;
      }

      const adapter = getAdapter(model.runtimeType);
      const raw = await adapter.complete({
        params: {
          modelId: model.modelId,
          temperature: prompt.resolved.version.temperature,
          maxTokens: prompt.resolved.version.maxTokens,
          apiKey,
        },
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
      });
      return ok({ model, raw });
    },
  },

  postProcess: {
    async finalise(req, _policy, prompt, routed) {
      const modelInvocationId = randomUUID();
      const { raw, model } = routed;
      const totalTokens = raw.inputTokens + raw.outputTokens;

      const parsed = parseJsonObject(raw.content);
      const status: UsageStatus = parsed.ok ? "ok" : "failed";

      // Record usage even on validation failure (token counts are known).
      // Metering must never break the inference path.
      try {
        await modelUsageCostService.record(req.ctx, {
          tenantId: req.ctx.tenantId,
          userId: req.ctx.userId,
          modelId: model.modelId,
          provider: model.runtimeType,
          agentRunId: req.agentRunId,
          modelInvocationId,
          inputTokens: raw.inputTokens,
          outputTokens: raw.outputTokens,
          totalTokens,
          estimatedCostUsd: estimateCost(model, raw.inputTokens, raw.outputTokens),
          latencyMs: raw.latencyMs,
          status,
          promptTemplateKey: req.promptTemplateId,
          promptVersionId: prompt.resolved.version.promptVersionDbId ?? null,
          isTest: req.invocationKind === "test",
          createdAt: new Date().toISOString(),
        });
      } catch {
        /* metering failure is swallowed; inference outcome stands */
      }

      if (!parsed.ok) return parsed;

      return ok({
        modelInvocationId,
        modelId: model.modelId,
        output: parsed.value,
        sourceReferences: req.sourceReferences,
        promptVersion: prompt.resolved.version.promptVersion,
        agentVersion: prompt.resolved.version.agentVersion,
        promptVersionDbId: prompt.resolved.version.promptVersionDbId ?? null,
      });
    },
  },
};
