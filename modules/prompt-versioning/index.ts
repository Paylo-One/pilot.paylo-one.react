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
 * Resolution: tenant-scoped prompts live in the database (tenant_prompts +
 * prompt_versions, managed from /prompts) and are resolved by the DB-backed
 * service in `./server`. This file keeps the pure types, the in-code default
 * registry, and `fallbackResolve` — the terminal fallback when a tenant has no
 * stored prompt (or the DB is unreachable), so inference never breaks. The
 * Gateway records the resolved `promptVersion` + `agentVersion` (and the DB
 * version id, when one served the call) on the invocation so outputs stay
 * reproducible/auditable.
 */

import type { Result, TenantContext } from "@/modules/shared";
import type { ModelPolicy } from "@/modules/model-gateway";

/** Lifecycle status of a prompt template/version. */
export type PromptStatus = "draft" | "active" | "archived" | "deprecated";

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
  /** Database id of the tenant prompt version that served this call, if any. */
  readonly promptVersionDbId?: string;
}

/** Which template/version the Gateway wants resolved for a call. */
export interface PromptResolutionRequest {
  readonly promptTemplateId: string;
  /** Optional pin to a specific version; absent resolves the pinned default. */
  readonly promptVersion?: string;
  /** Optional pin to an exact stored version row (test runs), any status. */
  readonly promptVersionId?: string;
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
export const DAILY_MEMO_SYSTEM_PROMPT = [
  "You are the daily briefing agent for Paylo.one, a calm intelligence layer for leaders.",
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
      name: "Daily briefing synthesis",
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

/**
 * Resolve from the in-code registry (or the generic JSON fallback). This is the
 * terminal branch of the DB-backed resolver in `./server` and the guarantee
 * that inference works for tenants with no stored prompts.
 */
export function fallbackResolve(req: PromptResolutionRequest): ResolvedPrompt {
  return PROMPT_REGISTRY[req.promptTemplateId] ?? genericPrompt(req.promptTemplateId);
}

// --- Tenant prompt library types (DB-backed; pure, importable by the UI) -----

/** The four workflow templates every tenant library is seeded with. */
export type PromptTemplateKey =
  | "daily_memo"
  | "signal_classification"
  | "signal_ranking"
  | "signal_triage";

export const PROMPT_WORKFLOW_LABELS: Record<PromptTemplateKey, string> = {
  daily_memo: "Briefing generation",
  signal_classification: "Signal classification",
  signal_ranking: "Signal ranking",
  signal_triage: "Triage & summarisation",
};

/** Lifecycle status of a stored tenant prompt version. */
export type StoredVersionStatus = "draft" | "active" | "archived";

/** A declared input variable/placeholder (documented metadata in v1). */
export interface PromptInputVariable {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
}

/** Expected output contract for a prompt version. */
export interface PromptOutputFormat {
  readonly schemaId: string;
  readonly description: string;
  /** Top-level JSON keys the output must contain (test validation). */
  readonly requiredKeys?: readonly string[];
}

/** Model/settings metadata bound to a prompt version. */
export interface PromptModelSettings {
  readonly policyName: string;
  readonly temperature: number;
  readonly maxTokens: number;
}

/** A tenant's prompt library entry (one per workflow). */
export interface TenantPrompt {
  readonly id: string;
  readonly templateKey: PromptTemplateKey;
  readonly name: string;
  readonly description: string | null;
  readonly workflow: string;
  readonly catalogueVersion: string;
  readonly archivedAt: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Library list row: the prompt plus its active version summary. */
export interface TenantPromptSummary extends TenantPrompt {
  readonly activeVersionNumber: number | null;
  readonly versionCount: number;
}

/** A stored, immutable prompt version. */
export interface StoredPromptVersion {
  readonly id: string;
  readonly tenantPromptId: string;
  readonly versionNumber: number;
  readonly content: string;
  readonly inputVariables: readonly PromptInputVariable[];
  readonly outputFormat: PromptOutputFormat;
  readonly modelSettings: PromptModelSettings;
  readonly status: StoredVersionStatus;
  readonly changeNote: string | null;
  readonly restoredFromVersionId: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly activatedAt: string | null;
  readonly archivedAt: string | null;
}

/** Detail view: the prompt with its full version history (newest first). */
export interface TenantPromptDetail extends TenantPrompt {
  readonly versions: readonly StoredPromptVersion[];
}

/** A recorded prompt test run. */
export interface StoredTestRun {
  readonly id: string;
  readonly tenantPromptId: string;
  readonly promptVersionId: string;
  readonly inputKind: "source_items" | "pasted";
  readonly inputPayload: unknown;
  readonly modelId: string | null;
  readonly modelSettings: PromptModelSettings | null;
  readonly status: "ok" | "failed";
  readonly output: unknown;
  readonly validation: unknown;
  readonly error: string | null;
  readonly latencyMs: number | null;
  readonly totalTokens: number | null;
  readonly createdAt: string;
}
