import "server-only";

/**
 * modules/action-extraction/dedupe.ts
 *
 * Semantic duplicate detection for suggested actions, applied at generation
 * time (before insert), not display time. Candidates are embedded with the
 * same model and canonical text form the semantic-linking pass uses, then
 * matched against OPEN actions for the same tenant via the
 * match_open_action_embeddings RPC (tenant-filtered, status-filtered,
 * recency-bounded in the database).
 *
 * Decision policy (ACTION_DEDUPE.version):
 * - similarity >= enrichThreshold: a confident duplicate. The candidate is NOT
 *   inserted; its source references are attached to the existing open action
 *   instead, so the existing action gains provenance rather than the inbox
 *   gaining noise. The decision is returned for the caller's audit record.
 * - reviewThreshold <= similarity < enrichThreshold: uncertain. The candidate
 *   IS inserted, carrying duplicate_group_id / duplicate_confidence /
 *   duplicate_reason so the Actions surface can offer a merge review. Nothing
 *   uncertain is merged silently.
 * - below reviewThreshold: distinct; inserted clean.
 *
 * If embeddings are unavailable (no LLM configured, gateway failure), the
 * pipeline degrades to the previous behaviour: insert everything, report
 * `dedupeApplied: false`. Extraction must never lose actions because the
 * embedding provider hiccuped.
 */

import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { llmEmbeddingModel } from "@/lib/llm";
import { modelGateway } from "@/modules/model-gateway";
import {
  canonicalKnowledgeText,
  contentHashFor,
} from "@/modules/semantic-linking";
import type { TenantContext } from "@/modules/shared";
import type {
  AttributedSuggestedActionPayload,
  MemoReferencePayload,
} from "@/modules/agent-orchestration/memo-attribution";

export const ACTION_DEDUPE = {
  version: "2026-07-30.v1",
  /** At or above: confident duplicate — enrich the existing action, do not insert. */
  enrichThreshold: 0.86,
  /** At or above (but below enrich): uncertain — insert flagged for review. */
  reviewThreshold: 0.72,
  /** Only open actions created within this window are duplicate candidates. */
  recencyDays: 90,
  /** Nearest neighbours fetched per candidate. */
  matchCount: 5,
} as const;

export type DuplicateVerdict = "enrich" | "review" | "distinct";

/** Pure threshold policy, exported for tests. */
export function classifyActionMatch(similarity: number | null | undefined): DuplicateVerdict {
  if (typeof similarity !== "number" || Number.isNaN(similarity)) return "distinct";
  if (similarity >= ACTION_DEDUPE.enrichThreshold) return "enrich";
  if (similarity >= ACTION_DEDUPE.reviewThreshold) return "review";
  return "distinct";
}

/** Canonical embedding text for a candidate action (mirrors semantic linking). */
export function candidateEmbeddingText(input: {
  readonly title: string;
  readonly rationale?: string | null;
  readonly dueAt?: string | null;
}): string {
  return canonicalKnowledgeText({
    entityType: "action",
    label: input.title,
    fields: [
      input.rationale ? `Rationale: ${input.rationale}` : null,
      "Status: inbox",
      input.dueAt ? `Due: ${input.dueAt}` : null,
    ],
  });
}

interface OpenActionMatch {
  readonly action_id: string;
  readonly title: string;
  readonly status: string;
  readonly created_at: string;
  readonly similarity: number;
}

export interface DedupeDecision {
  readonly candidateTitle: string;
  readonly verdict: DuplicateVerdict;
  readonly matchedActionId: string | null;
  readonly matchedTitle: string | null;
  readonly similarity: number | null;
}

export interface DedupePersistResult {
  /** Whether embedding-based dedupe actually ran. */
  readonly dedupeApplied: boolean;
  readonly inserted: number;
  readonly enriched: number;
  readonly flaggedForReview: number;
  readonly decisions: readonly DedupeDecision[];
}

function vectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.map((n) => Number(n).toFixed(8)).join(",")}]`;
}

/** Insert candidates via the transactional RPC; returns the inserted ids. */
async function persistActions(
  secret: ReturnType<typeof createSupabaseSecretClient>,
  tenantId: string,
  actions: readonly Record<string, unknown>[],
): Promise<string[]> {
  if (actions.length === 0) return [];
  const { data, error } = await secret.rpc("persist_suggested_actions_v2", {
    p_tenant_id: tenantId,
    p_actions: actions,
  });
  if (error) throw new Error(error.message ?? "action_persist_failed");
  return (data ?? []) as string[];
}

/** Attach a duplicate candidate's references to the existing open action. */
async function enrichExistingAction(
  secret: ReturnType<typeof createSupabaseSecretClient>,
  tenantId: string,
  existingActionId: string,
  references: readonly MemoReferencePayload[],
): Promise<void> {
  if (references.length === 0) return;
  const { data: existingRefs } = await secret
    .from("source_references")
    .select("source_item_id")
    .eq("tenant_id", tenantId)
    .eq("suggested_action_id", existingActionId);
  const known = new Set(
    ((existingRefs ?? []) as { source_item_id: string | null }[])
      .map((row) => row.source_item_id)
      .filter(Boolean),
  );
  const fresh = references.filter(
    (ref) => ref.source_item_id && !known.has(ref.source_item_id),
  );
  if (fresh.length === 0) return;
  const { error } = await secret.from("source_references").insert(
    fresh.map((ref) => ({
      tenant_id: tenantId,
      suggested_action_id: existingActionId,
      source_item_id: ref.source_item_id,
      source_system: ref.source_system,
      item_timestamp: ref.item_timestamp,
      confidence: ref.confidence,
      excerpt_or_pointer: ref.excerpt_or_pointer,
    })),
  );
  if (error) throw new Error(error.message);
}

/** Store embeddings for freshly inserted actions so the next run sees them. */
async function storeActionEmbeddings(
  secret: ReturnType<typeof createSupabaseSecretClient>,
  tenantId: string,
  embeddingModel: string,
  rows: readonly { id: string; text: string; embedding: readonly number[] }[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await secret.from("knowledge_embeddings").upsert(
    rows.map((row) => ({
      tenant_id: tenantId,
      entity_type: "action",
      entity_id: row.id,
      owner_user_id: null,
      content_hash: contentHashFor(row.text),
      embedding_model: embeddingModel,
      embedding: row.embedding as number[],
      visibility: "normal",
    })),
    { onConflict: "tenant_id,entity_type,entity_id,embedding_model" },
  );
  if (error) throw new Error(error.message);
}

/**
 * Deduplicate extracted candidates against open actions, then persist:
 * enrich confident matches, flag uncertain ones for review, insert the rest.
 * Every decision is returned so the caller can audit it; nothing is merged
 * silently below the enrich threshold.
 */
export async function dedupeAndPersistSuggestedActions(
  ctx: TenantContext,
  candidates: readonly AttributedSuggestedActionPayload[],
): Promise<DedupePersistResult> {
  const secret = createSupabaseSecretClient();
  if (candidates.length === 0) {
    return { dedupeApplied: false, inserted: 0, enriched: 0, flaggedForReview: 0, decisions: [] };
  }

  const texts = candidates.map((candidate) =>
    candidateEmbeddingText({
      title: candidate.title,
      rationale: candidate.rationale,
      dueAt: candidate.due_at,
    }),
  );

  let embeddings: readonly (readonly number[])[] | null = null;
  const embeddingModel = llmEmbeddingModel();
  try {
    const embedded = await modelGateway.embed({
      ctx,
      dataClassification: "confidential",
      inputs: texts,
    });
    if (embedded.ok && embedded.value.embeddings.length === candidates.length) {
      embeddings = embedded.value.embeddings;
    }
  } catch {
    embeddings = null;
  }

  // Degraded path: no embeddings — insert everything, exactly as before.
  if (!embeddings) {
    const inserted = await persistActions(
      secret,
      ctx.tenantId,
      candidates.map((candidate) => ({ ...candidate })),
    );
    return {
      dedupeApplied: false,
      inserted: inserted.length,
      enriched: 0,
      flaggedForReview: 0,
      decisions: [],
    };
  }

  const decisions: DedupeDecision[] = [];
  const toInsert: { payload: Record<string, unknown>; text: string; embedding: readonly number[] }[] = [];
  let enriched = 0;
  let flaggedForReview = 0;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    const embedding = embeddings[index]!;

    let best: OpenActionMatch | null = null;
    try {
      const { data, error } = await secret.rpc("match_open_action_embeddings", {
        p_tenant_id: ctx.tenantId,
        p_query_embedding: vectorLiteral(embedding),
        p_embedding_model: embeddingModel,
        p_match_count: ACTION_DEDUPE.matchCount,
        p_recency_days: ACTION_DEDUPE.recencyDays,
      });
      if (!error) {
        best = ((data ?? []) as OpenActionMatch[])[0] ?? null;
      }
    } catch {
      best = null;
    }

    const verdict = classifyActionMatch(best ? Number(best.similarity) : null);
    decisions.push({
      candidateTitle: candidate.title,
      verdict,
      matchedActionId: best?.action_id ?? null,
      matchedTitle: best?.title ?? null,
      similarity: best ? Math.round(Number(best.similarity) * 1000) / 1000 : null,
    });

    if (verdict === "enrich" && best) {
      await enrichExistingAction(secret, ctx.tenantId, best.action_id, candidate.references);
      enriched += 1;
      continue;
    }

    if (verdict === "review" && best) {
      flaggedForReview += 1;
      toInsert.push({
        payload: {
          ...candidate,
          duplicate_group_id: best.action_id,
          duplicate_confidence: Math.round(Number(best.similarity) * 1000) / 1000,
          duplicate_reason: `Similar to "${candidate.title === best.title ? best.action_id : best.title}" (semantic match, policy ${ACTION_DEDUPE.version}).`,
        },
        text: texts[index]!,
        embedding,
      });
      continue;
    }

    toInsert.push({ payload: { ...candidate }, text: texts[index]!, embedding });
  }

  const insertedIds = await persistActions(
    secret,
    ctx.tenantId,
    toInsert.map((item) => item.payload),
  );

  // Persist embeddings for the new rows so the very next extraction run can
  // match against them without waiting for the semantic-linking sweep.
  try {
    await storeActionEmbeddings(
      secret,
      ctx.tenantId,
      embeddingModel,
      insertedIds.map((id, index) => ({
        id,
        text: toInsert[index]?.text ?? "",
        embedding: toInsert[index]?.embedding ?? [],
      })).filter((row) => row.text && row.embedding.length > 0),
    );
  } catch {
    // Embedding storage is an optimisation; the semantic-linking pass backfills.
  }

  return {
    dedupeApplied: true,
    inserted: insertedIds.length,
    enriched,
    flaggedForReview,
    decisions,
  };
}
