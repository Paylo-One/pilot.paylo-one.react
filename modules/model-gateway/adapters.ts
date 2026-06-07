/**
 * modules/model-gateway/adapters.ts — the provider-abstraction layer. Frontier
 * APIs and Paylo-hosted vLLM are interchangeable backends behind ONE adapter
 * interface (`ModelAdapter`). The Gateway routes to an adapter; nothing above
 * the Gateway knows which provider/runtime served a call.
 *
 * Governance:
 *  - architecture/model-inference-architecture.md §2 ("Providers are adapters"),
 *    §6 (provider types), §16 (vLLM must be addable with NO app/agent change)
 *  - services/model-gateway-service.md ("provider abstraction … behind one
 *    adapter interface"); External APIs ("All only via adapters")
 *  - architecture/security-and-privacy.md §"Model Gateway & Inference Security"
 *    (provider keys + vLLM endpoint are server-side only)
 *
 * vLLM extensibility (explicit): the `vllm` adapter already exists below as a
 * stub and is registered in `adapterRegistry`. Standing up vLLM later means
 * implementing THIS adapter only — no change to GatewayRequest, the pipeline,
 * agents, workflows, or any caller. New runtimes are added the same way: a new
 * `ModelAdapter` implementation behind this contract. Provider types never leak
 * upward (no vendor lock-in).
 *
 * MVP status: the `openai` adapter is implemented for real against the hosted
 * OpenAI Chat Completions + Embeddings APIs (server-side key only). All other
 * adapters remain stubs that throw NotImplementedError at the provider
 * boundary; standing up vLLM/another provider means implementing its adapter
 * here, with no change to any caller.
 */

import "server-only";

import OpenAI from "openai";
import { AppError, NotImplementedError } from "@/modules/shared";

/**
 * The concrete runtime types that have a first-class adapter. The catalogue's
 * `RuntimeType` additionally allows `custom` (future tenant-owned/private
 * endpoints), which will plug in as another `ModelAdapter` when introduced.
 */
export type AdapterRuntimeType =
  | "openai"
  | "anthropic"
  | "azure_openai"
  | "google"
  | "vllm";

/** Resolved model parameters passed to an adapter (from the prompt version). */
export interface AdapterModelParams {
  readonly modelId: string;
  readonly temperature: number;
  readonly maxTokens: number;
}

/**
 * A fully assembled completion request handed to an adapter. The Gateway has
 * already enforced policy and assembled the prompt; the adapter only performs
 * the provider/runtime call.
 */
export interface AdapterCompletionRequest {
  readonly params: AdapterModelParams;
  /** System instructions (from the resolved prompt template — server-only). */
  readonly systemPrompt: string;
  /** Assembled, tenant-scoped user/content message. */
  readonly userPrompt: string;
}

/** Raw provider/runtime completion output, normalised across backends. */
export interface AdapterCompletionResult {
  /** Raw text/JSON body; schema validation happens in the Gateway post-process. */
  readonly content: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
}

/** An embedding request handed to an adapter. */
export interface AdapterEmbedRequest {
  readonly modelId: string;
  readonly inputs: readonly string[];
}

/** Embedding output, normalised across backends. */
export interface AdapterEmbedResult {
  readonly embeddings: readonly (readonly number[])[];
  readonly inputTokens: number;
  readonly latencyMs: number;
}

/**
 * The single contract every provider/runtime backend implements. The Gateway
 * depends only on this interface — never on a concrete provider SDK.
 */
export interface ModelAdapter {
  readonly runtimeType: AdapterRuntimeType;
  complete(req: AdapterCompletionRequest): Promise<AdapterCompletionResult>;
  embed(req: AdapterEmbedRequest): Promise<AdapterEmbedResult>;
}

/** Build a stub adapter for a runtime; both methods throw at the provider boundary. */
function makeStubAdapter(runtimeType: AdapterRuntimeType): ModelAdapter {
  return {
    runtimeType,
    async complete() {
      throw new NotImplementedError(`model-gateway.adapter[${runtimeType}].complete`);
    },
    async embed() {
      throw new NotImplementedError(`model-gateway.adapter[${runtimeType}].embed`);
    },
  };
}

/**
 * Lazily construct the OpenAI client so merely importing this module never
 * requires the key; it is read from server env at call time and never leaves
 * the server (security-and-privacy.md: provider keys are server-side only).
 */
function openAiClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new AppError("internal", "OPENAI_API_KEY is not set");
  }
  return new OpenAI({ apiKey });
}

/**
 * Real hosted-OpenAI adapter. `complete` forces a JSON object response so the
 * Gateway's post-process can validate structured output; `embed` calls the
 * embeddings endpoint. Token counts + latency are returned for usage metering.
 */
const realOpenAiAdapter: ModelAdapter = {
  runtimeType: "openai",
  async complete(req) {
    const client = openAiClient();
    const startedAt = Date.now();
    const completion = await client.chat.completions.create({
      model: req.params.modelId,
      temperature: req.params.temperature,
      max_tokens: req.params.maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: req.systemPrompt },
        { role: "user", content: req.userPrompt },
      ],
    });
    const latencyMs = Date.now() - startedAt;
    return {
      content: completion.choices[0]?.message?.content ?? "",
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      latencyMs,
    };
  },
  async embed(req) {
    const client = openAiClient();
    const startedAt = Date.now();
    const res = await client.embeddings.create({
      model: req.modelId,
      input: [...req.inputs],
    });
    const latencyMs = Date.now() - startedAt;
    return {
      embeddings: res.data.map((d) => d.embedding),
      inputTokens: res.usage?.prompt_tokens ?? 0,
      latencyMs,
    };
  },
};

export const openaiAdapter: ModelAdapter = realOpenAiAdapter;
export const anthropicAdapter: ModelAdapter = makeStubAdapter("anthropic");
export const azureOpenAiAdapter: ModelAdapter = makeStubAdapter("azure_openai");
export const googleAdapter: ModelAdapter = makeStubAdapter("google");
/** Stub today; implementing this single adapter is all vLLM rollout requires. */
export const vllmAdapter: ModelAdapter = makeStubAdapter("vllm");

/**
 * Registry the Gateway uses to resolve a runtime → adapter. Adding a runtime
 * (e.g. a future `custom` tenant endpoint) means adding one entry here plus its
 * adapter implementation — nothing else changes.
 */
export const adapterRegistry: Readonly<Record<AdapterRuntimeType, ModelAdapter>> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  azure_openai: azureOpenAiAdapter,
  google: googleAdapter,
  vllm: vllmAdapter,
};

/** Resolve the adapter for a runtime type (used by the routing stage). */
export function getAdapter(runtimeType: AdapterRuntimeType): ModelAdapter {
  return adapterRegistry[runtimeType];
}
