/**
 * modules/prompt-versioning — versions prompt templates and binds them to agent
 * versions, model policy, parameters, output schema, retrieval policy, and
 * source-reference policy. The Model Gateway resolves a prompt version at call
 * time and records it on the invocation, so every AI output is reproducible
 * and auditable.
 *
 * Governance:
 *  - services/prompt-versioning-service.md (fields, immutability, resolution)
 *  - architecture/model-inference-architecture.md §11 (prompt versioning)
 *  - architecture/data-architecture.md "Prompt template"/"Prompt version" objects
 *
 * Security: prompt templates are SYSTEM INSTRUCTIONS — server-side only;
 * ingested content is never treated as a template. Versions are immutable once
 * used so audited outputs stay reproducible.
 *
 * MVP implementation: templates/versions are an in-code, immutable registry
 * (no DB table is provisioned for prompts yet). `resolve` returns the pinned
 * version for a known `promptTemplateId`, or a generic JSON-output fallback for
 * any other id. The Gateway records the resolved `promptVersion` + `agentVersion`
 * on the invocation so outputs stay reproducible/auditable.
 */

import {
  ValidationError,
  err,
  ok,
  type Result,
  type TenantContext,
} from "@/modules/shared";
import type { ModelPolicy } from "@/modules/model-gateway";

/** Lifecycle status of a prompt template/version. */
export type PromptStatus = "draft" | "active" | "deprecated";

/** Retrieval behaviour bound to a prompt version (bounded context for cost/privacy). */
export interface RetrievalPolicy {
  /** Whether the prompt assembles tenant-filtered retrieval context. */
  readonly enabled: boolean;
  /** Maximum number of retrieval items to include. */
  readonly maxItems: number;
}

/** Source-reference requirements bound to a prompt version (trust contract). */
export interface SourceReferencePolicy {
  /** Whether the output must carry ≥1 source reference (else it is withheld). */
  readonly required: boolean;
  /** Minimum confidence for a reference to count toward the requirement. */
  readonly minConfidence: number;
}

/**
 * A named prompt for an agent/task. Mirrors the `prompt_template` object in
 * data-architecture.md. Platform-scoped (tenant overrides are a future option).
 */
export interface PromptTemplate {
  readonly promptTemplateId: string;
  readonly agentName: string;
  readonly name: string;
  readonly description: string;
  readonly status: PromptStatus;
}

/**
 * An immutable version of a template, bound to an agent version, model policy,
 * parameters, output schema, and retrieval/source-reference policies. Mirrors
 * the `prompt_version` object in data-architecture.md.
 */
export interface PromptVersion {
  readonly promptVersionId: string;
  readonly promptTemplateId: string;
  readonly promptVersion: string;
  /** The exact agent version this prompt is bound to. */
  readonly agentVersion: string;
  /**
   * The system instruction text resolved for this version. SYSTEM INSTRUCTIONS
   * are server-side only and never assembled from ingested content; the Gateway
   * passes this to the adapter as the system prompt.
   */
  readonly systemPrompt: string;
  /** Routing policy this prompt targets (validated against the catalogue). */
  readonly modelPolicy: ModelPolicy;
  readonly temperature: number;
  readonly maxTokens: number;
  /** Reference to the structured-output schema the Gateway validates against. */
  readonly structuredOutputSchemaId: string;
  readonly retrievalPolicy: RetrievalPolicy;
  readonly sourceReferencePolicy: SourceReferencePolicy;
  readonly status: PromptStatus;
  readonly createdAt: string;
}

/** Which template/version the Gateway wants resolved for a call. */
export interface PromptResolutionRequest {
  readonly promptTemplateId: string;
  /** Optional pin to a specific version; absent resolves the pinned default. */
  readonly promptVersion?: string;
}

/**
 * The fully resolved prompt version + bound parameters/schema/policies returned
 * to the Gateway and recorded on the invocation.
 */
export interface ResolvedPrompt {
  readonly template: PromptTemplate;
  readonly version: PromptVersion;
}

/**
 * Resolves prompt versions for the Gateway. Templates/versions are platform-
 * scoped definitions; the tenant context is accepted for future tenant-specific
 * overrides and for audit attribution.
 */
export interface PromptVersioningService {
  /** Resolve the prompt template + (pinned or requested) version for a call. */
  resolve(
    ctx: TenantContext,
    req: PromptResolutionRequest,
  ): Promise<Result<ResolvedPrompt>>;
}

/**
 * The Daily Memo system instruction (pinned). It binds the model to the product
 * trust contract: synthesise only from supplied items, reference them by their
 * id token, never fabricate, and emit STRICT JSON the Gateway can validate.
 */
const DAILY_MEMO_SYSTEM_PROMPT = [
  "You are the Daily Memo agent for Paylo.one, an executive management OS.",
  "You compose a calm, high-signal daily briefing from the operator's own connected channels.",
  "",
  "Rules:",
  "- Synthesise ONLY from the supplied items. Never invent facts, names, dates, or events.",
  "- Rank by consequence, not chronology. Be brief and editorial. Use British spelling.",
  "- Every section and every action MUST cite the item id tokens (e.g. \"item-1\") it draws from.",
  "- Do not manufacture urgency. If little happened, say so plainly.",
  "",
  "Return STRICT JSON only (no prose, no markdown) matching exactly this shape:",
  "{",
  '  "summary": string,            // 2-4 sentence executive summary',
  '  "sections": [                 // ordered, most consequential first',
  "    {",
  '      "kind": string,           // e.g. "critical", "decisions", "follow_ups", "risks", "signals"',
  '      "title": string,',
  '      "body": string,',
  '      "sourceItemIds": string[],// >=1 supplied item id token',
  '      "confidence": number      // 0..1',
  "    }",
  "  ],",
  '  "actions": [                  // candidate actions for the operator to approve',
  "    {",
  '      "title": string,',
  '      "rationale": string,',
  '      "sourceItemIds": string[] // >=1 supplied item id token',
  "    }",
  "  ]",
  "}",
].join("\n");

/** Generic JSON-output fallback for templates without a pinned registry entry. */
const GENERIC_JSON_SYSTEM_PROMPT = [
  "You are an assistant for Paylo.one. Synthesise only from the supplied context;",
  "never fabricate. Return STRICT JSON only (no prose, no markdown).",
].join("\n");

/** Immutable in-code prompt registry keyed by `promptTemplateId`. */
const PROMPT_REGISTRY: Readonly<Record<string, ResolvedPrompt>> = {
  daily_memo: {
    template: {
      promptTemplateId: "daily_memo",
      agentName: "daily_memo",
      name: "Daily Memo synthesis",
      description: "Composes the executive daily briefing from connected channels.",
      status: "active",
    },
    version: {
      promptVersionId: "daily_memo@1",
      promptTemplateId: "daily_memo",
      promptVersion: "1.0.0",
      agentVersion: "daily_memo-agent@1.0.0",
      systemPrompt: DAILY_MEMO_SYSTEM_PROMPT,
      modelPolicy: { policyName: "daily-memo-synthesis" },
      temperature: 0.3,
      maxTokens: 1500,
      structuredOutputSchemaId: "daily_memo_output@1",
      retrievalPolicy: { enabled: true, maxItems: 25 },
      sourceReferencePolicy: { required: true, minConfidence: 0 },
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  },
};

function genericPrompt(promptTemplateId: string): ResolvedPrompt {
  return {
    template: {
      promptTemplateId,
      agentName: promptTemplateId,
      name: promptTemplateId,
      description: "Generic JSON-output prompt (fallback).",
      status: "active",
    },
    version: {
      promptVersionId: `${promptTemplateId}@1`,
      promptTemplateId,
      promptVersion: "1.0.0",
      agentVersion: `${promptTemplateId}-agent@1.0.0`,
      systemPrompt: GENERIC_JSON_SYSTEM_PROMPT,
      modelPolicy: { policyName: "default" },
      temperature: 0.2,
      maxTokens: 1200,
      structuredOutputSchemaId: `${promptTemplateId}_output@1`,
      retrievalPolicy: { enabled: true, maxItems: 25 },
      sourceReferencePolicy: { required: false, minConfidence: 0 },
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

export const promptVersioningService: PromptVersioningService = {
  async resolve(_ctx, req) {
    const resolved = PROMPT_REGISTRY[req.promptTemplateId] ?? genericPrompt(req.promptTemplateId);
    // A pinned version request must match the registry's immutable version.
    if (req.promptVersion && req.promptVersion !== resolved.version.promptVersion) {
      return err(
        new ValidationError("requested prompt version is not available", {
          promptTemplateId: req.promptTemplateId,
          requested: req.promptVersion,
          available: resolved.version.promptVersion,
        }),
      );
    }
    return ok(resolved);
  },
};
