/**
 * modules/model-gateway/types.ts — the request/response contract callers use to
 * reach the Paylo Model Gateway. Agents and workflows hand the Gateway a typed
 * request; they never assemble a provider call themselves.
 *
 * Governance:
 *  - architecture/model-inference-architecture.md §5, §12 (request flow, what
 *    agents hand the Gateway)
 *  - services/model-gateway-service.md (Inputs/Outputs)
 *  - architecture/security-and-privacy.md §"Model Gateway & Inference Security"
 *    (data classification before routing)
 *
 * Scaffold note: types only.
 */

import type { SourceReference, TenantContext } from "@/modules/shared";
import type { ModelTask } from "@/modules/model-catalogue";

/**
 * Sensitivity class assigned to a request's payload. The Gateway gates which
 * models/runtimes/providers may receive each class before routing
 * (security-and-privacy.md §"Data classification before routing"; e.g. highly
 * sensitive Diary content prefers a Paylo-hosted/private runtime).
 *
 * NOTE (shared-type assumption): governance references `data_classification`
 * but does not enumerate the values. This four-tier scale is defined here in
 * the Model Gateway (the owning pillar) and re-used by sibling modules via
 * type-only imports. Promote to `@/modules/shared` if other pillars need it.
 */
export type DataClassification =
  | "public"
  | "internal"
  | "confidential"
  | "restricted";

/**
 * A reference to a named routing/fallback policy OR an explicit ordered list of
 * candidate model ids (cheap-first, escalate). Mirrors `model_fallback_policy`
 * in data-architecture.md. A caller supplies EITHER a `requestedModelId` OR a
 * `modelPolicy` on the request (not neither).
 */
export interface ModelPolicy {
  /** Named policy (e.g. "daily-memo-synthesis"), resolved server-side. */
  readonly policyName?: string;
  /** Explicit ordered candidate model ids; first routable wins. */
  readonly orderedModelIds?: readonly string[];
}

/**
 * A unit of tenant-filtered retrieval context handed to prompt assembly. The
 * Gateway re-asserts tenant scope at assembly time
 * (model-inference-architecture.md §8).
 */
export interface RetrievalContextItem {
  readonly sourceItemId: string;
  /** Condensed/derived text (summaries-over-raw; never the raw body by default). */
  readonly summary: string;
  readonly occurredAt: string;
}

/** The expected structured-output schema for a completion (validated post-call). */
export interface OutputSchemaRef {
  readonly schemaId: string;
  readonly schemaVersion: string;
}

/**
 * What an agent/workflow hands the Gateway for a completion. The Gateway runs
 * policy → assembly → route → post-process and returns a validated, source-
 * linked result (model-inference-architecture.md §12).
 */
export interface GatewayRequest {
  /** Server-trusted tenant + user context; the call is bound to one tenant. */
  readonly ctx: TenantContext;
  /** The agent/task type driving model selection and entitlement. */
  readonly task: ModelTask;
  /** Optional agent identifier for usage/audit attribution. */
  readonly agentRunId?: string;
  /** Sensitivity of the payload; gates routing before tokens are spent. */
  readonly dataClassification: DataClassification;
  /** Prompt template to resolve via Prompt Versioning. */
  readonly promptTemplateId: string;
  /** Optional pin to a specific prompt version; otherwise the default is used. */
  readonly promptVersion?: string;
  /** Optional pin to an exact stored tenant prompt version (test runs). */
  readonly promptVersionId?: string;
  /** Why the call is made; "test" flags the metering row (default "agent"). */
  readonly invocationKind?: "agent" | "test";
  /** Tenant-filtered retrieval context for prompt assembly. */
  readonly retrievalContext: readonly RetrievalContextItem[];
  /** Source references that must be carried through onto the output. */
  readonly sourceReferences: readonly SourceReference[];
  /** Explicit model request; mutually exclusive with `modelPolicy`. */
  readonly requestedModelId?: string;
  /** Routing/fallback policy; mutually exclusive with `requestedModelId`. */
  readonly modelPolicy?: ModelPolicy;
  /** Schema the structured output is validated against. */
  readonly expectedOutputSchema: OutputSchemaRef;
}

/**
 * The validated, source-linked result of a Gateway completion, plus the
 * provenance/audit handles every AI output must carry
 * (model-inference-architecture.md §5 post-process).
 */
export interface GatewayResult {
  /** The id of the persisted `model_invocation` (audit/usage anchor). */
  readonly modelInvocationId: string;
  /** The model that actually served the call (after routing/fallback). */
  readonly modelId: string;
  /** Structured output, already validated against `expectedOutputSchema`. */
  readonly output: Record<string, unknown>;
  /** Source references attached to the output (≥1 required, else withheld). */
  readonly sourceReferences: readonly SourceReference[];
  /** Prompt + agent versions recorded for reproducibility. */
  readonly promptVersion: string;
  readonly agentVersion: string;
  /** Database id of the tenant prompt version that served the call, if any. */
  readonly promptVersionDbId: string | null;
}

/** What a caller hands the Gateway for an embedding call. */
export interface EmbedRequest {
  readonly ctx: TenantContext;
  readonly dataClassification: DataClassification;
  /** Texts to embed (already tenant-scoped, summaries-over-raw). */
  readonly inputs: readonly string[];
  readonly requestedModelId?: string;
  readonly modelPolicy?: ModelPolicy;
  readonly agentRunId?: string;
}

/** The result of an embedding call. */
export interface EmbedResult {
  readonly modelInvocationId: string;
  readonly modelId: string;
  /** One vector per input, in input order. */
  readonly embeddings: readonly (readonly number[])[];
}
