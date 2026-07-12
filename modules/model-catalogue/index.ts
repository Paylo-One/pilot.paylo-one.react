/**
 * modules/model-catalogue — the registry of every routable model across
 * Paylo-hosted, external, and tenant-owned providers, with the metadata the
 * Model Gateway needs to route a task to the right model/runtime WITHOUT any
 * hard-coded provider knowledge.
 *
 * Governance:
 *  - services/model-catalogue-service.md (fields, lifecycle, routing rules)
 *  - architecture/model-inference-architecture.md §6, §10 (provider types,
 *    catalogue-driven routing; "nothing routes to a model that isn't
 *    catalogued and active")
 *  - architecture/data-architecture.md "Model" object (platform-scoped;
 *    tenant-owned models are tenant-scoped)
 *
 * MVP implementation: a small in-code catalogue. The only routable model is the
 * hosted OpenAI chat model named by `OPENAI_MODEL` (default `gpt-4o-mini`),
 * exposed behind the `openai` runtime adapter. No secrets live here (the API
 * key stays in server env). Adding vLLM/other runtimes later means adding
 * catalogue entries + their adapters — no caller change.
 */

import {
  AppError,
  err,
  ok,
  type Result,
  type TenantContext,
} from "@/modules/shared";
// Type-only import (erased at compile time → no runtime cycle with the gateway).
import type { DataClassification } from "@/modules/model-gateway";

/**
 * The runtime a model executes on. Frontier APIs and vLLM are interchangeable
 * backends behind the Gateway's adapter interface; `custom` covers future
 * tenant-owned/private endpoints. Mirrors the `runtime_type` enum in
 * model-catalogue-service.md and data-architecture.md.
 */
export type RuntimeType =
  | "vllm"
  | "openai"
  | "anthropic"
  | "azure_openai"
  | "google"
  | "custom";

/** Who owns a catalogue entry (data-architecture.md "Model"). */
export type ModelOwnerType = "paylo" | "tenant" | "external";

/** Model lifecycle status. Only `active` models are routable. */
export type ModelStatus = "active" | "experimental" | "deprecated";

/**
 * The set of tasks a model may be marked as supporting (catalogue
 * `supported_tasks`). Aligns with the MVP agents and the task list in
 * model-catalogue-service.md ("summarisation, extraction, reasoning,
 * embeddings, …").
 */
export type ModelTask =
  | "reasoning"
  | "summarisation"
  | "classification"
  | "extraction"
  | "action_extraction"
  | "priority_scoring"
  | "risk_signal"
  | "transcription"
  | "embeddings";

/** Estimated per-token cost profile (USD per 1k tokens), used for cost attribution. */
export interface CostProfile {
  readonly inputPer1kUsd: number;
  readonly outputPer1kUsd: number;
}

/** Observed/typical latency characteristics, used by routing heuristics later. */
export interface LatencyProfile {
  readonly typicalMs: number;
  readonly p95Ms: number;
}

/**
 * Data-handling constraints for a model. The Gateway gates which data
 * classifications may reach this model (security-and-privacy.md §"Data
 * classification before routing").
 */
export interface DataPolicy {
  /** Highest data classification this model/runtime is permitted to receive. */
  readonly maxDataClassification: DataClassification;
  /** Whether the provider's terms prohibit training on inputs (required for hosted use). */
  readonly noTrainingOnInputs: boolean;
  /** Optional residency/processing notes for audit. */
  readonly notes?: string;
}

/**
 * A catalogue entry describing one routable model. Field set mirrors the
 * "Model" object in data-architecture.md and model-catalogue-service.md.
 */
export interface ModelDescriptor {
  readonly modelId: string;
  /** Provider/runtime family this model belongs to. */
  readonly provider: RuntimeType;
  readonly runtimeType: RuntimeType;
  readonly displayName: string;
  readonly baseModel: string;
  readonly modelVersion: string;
  readonly contextWindow: number;
  readonly supportedTasks: readonly ModelTask[];
  readonly supportsStructuredOutput: boolean;
  readonly supportsEmbeddings: boolean;
  readonly supportsToolCalls: boolean;
  readonly costProfile: CostProfile;
  readonly latencyProfile: LatencyProfile;
  readonly dataPolicy: DataPolicy;
  readonly ownerType: ModelOwnerType;
  readonly status: ModelStatus;
}

/** Optional filter when listing routable models. */
export interface CatalogueFilter {
  readonly task?: ModelTask;
  readonly runtimeType?: RuntimeType;
  readonly requiresStructuredOutput?: boolean;
  readonly requiresEmbeddings?: boolean;
  readonly requiresToolCalls?: boolean;
}

/**
 * Read-only registry consulted by the Model Gateway during routing. Platform
 * (Paylo/external) models are shared; tenant-owned models are visible only to
 * their tenant, so reads accept an optional tenant context for that scoping.
 */
export interface ModelCatalogueService {
  /** Look up a single catalogue entry by id (platform- or tenant-scoped). */
  get(modelId: string, ctx?: TenantContext): Promise<Result<ModelDescriptor>>;

  /** List models that are `active` and match the filter (routing candidates). */
  listActive(
    filter?: CatalogueFilter,
    ctx?: TenantContext,
  ): Promise<Result<ModelDescriptor[]>>;

  /**
   * Assert a model is catalogued AND routable (status `active`). The Gateway
   * calls this before routing so nothing is ever sent to an uncatalogued,
   * experimental, or deprecated model.
   */
  assertRoutable(
    modelId: string,
    ctx?: TenantContext,
  ): Promise<Result<ModelDescriptor>>;
}

/**
 * The default chat model id, from server env (default gpt-4o-mini). Reached
 * through the OpenAI-compatible adapter; when an EU router is configured
 * (LLM_BASE_URL + LLM_MODEL, ADR-045) this is a provider-prefixed EU model id
 * such as "mistral/mistral-small-latest".
 */
export function defaultOpenAiModelId(): string {
  return process.env.LLM_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

/** Build the single active default catalogue entry (MVP). */
function defaultOpenAiModel(): ModelDescriptor {
  const modelId = defaultOpenAiModelId();
  // Reflect EU-resident inference in the display name when it is configured,
  // so audit/usage surfaces name the region rather than assuming hosted OpenAI.
  const isEu = /\brouter\.eu\.requesty\.ai\b/i.test(process.env.LLM_BASE_URL?.trim() || "");
  return {
    modelId,
    provider: "openai",
    runtimeType: "openai",
    displayName: isEu ? `EU · ${modelId}` : `OpenAI ${modelId}`,
    baseModel: modelId,
    modelVersion: "hosted",
    contextWindow: 128_000,
    supportedTasks: [
      "reasoning",
      "summarisation",
      "classification",
      "extraction",
      "action_extraction",
      "priority_scoring",
      "risk_signal",
    ],
    supportsStructuredOutput: true,
    supportsEmbeddings: false,
    supportsToolCalls: true,
    // Approximate gpt-4o-mini pricing (USD per 1k tokens); used for cost metering.
    costProfile: { inputPer1kUsd: 0.00015, outputPer1kUsd: 0.0006 },
    latencyProfile: { typicalMs: 1500, p95Ms: 4000 },
    // MVP: a single hosted model serves all classifications; tightened later.
    dataPolicy: { maxDataClassification: "restricted", noTrainingOnInputs: true },
    ownerType: "external",
    status: "active",
  };
}

/** The active catalogue (MVP: one hosted OpenAI model). */
function activeModels(): ModelDescriptor[] {
  return [defaultOpenAiModel()];
}

function matchesFilter(m: ModelDescriptor, filter?: CatalogueFilter): boolean {
  if (!filter) return true;
  if (filter.task && !m.supportedTasks.includes(filter.task)) return false;
  if (filter.runtimeType && m.runtimeType !== filter.runtimeType) return false;
  if (filter.requiresStructuredOutput && !m.supportsStructuredOutput) return false;
  if (filter.requiresEmbeddings && !m.supportsEmbeddings) return false;
  if (filter.requiresToolCalls && !m.supportsToolCalls) return false;
  return true;
}

export const modelCatalogueService: ModelCatalogueService = {
  async get(modelId) {
    const model = activeModels().find((m) => m.modelId === modelId);
    if (!model) {
      return err(new AppError("not_found", `model not catalogued: ${modelId}`));
    }
    return ok(model);
  },
  async listActive(filter) {
    return ok(activeModels().filter((m) => m.status === "active" && matchesFilter(m, filter)));
  },
  async assertRoutable(modelId) {
    const model = activeModels().find((m) => m.modelId === modelId && m.status === "active");
    if (!model) {
      return err(
        new AppError("not_found", `model is not catalogued or not active: ${modelId}`),
      );
    }
    return ok(model);
  },
};
