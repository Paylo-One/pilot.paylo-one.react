import "server-only";

/**
 * modules/semantic-linking/service.ts
 *
 * Background semantic linking for the relationship graph. It embeds tenant-owned
 * graph records, stores those vectors in `knowledge_embeddings`, then proposes
 * confirmable `entity_links` from bounded tenant-filtered nearest-neighbour
 * matches. Semantic links are suggestions only: confirmed and rejected operator
 * decisions are never overwritten.
 */

import { createHash } from "node:crypto";
import { llmEmbeddingModel } from "@/lib/llm";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import {
  modelGateway,
  type EmbedResult,
} from "@/modules/model-gateway";
import type { TenantContext } from "@/modules/shared";
import type { EntityType, LinkVisibility } from "@/modules/people/people.types";

export type SemanticEntityType = Extract<
  EntityType,
  "person" | "company" | "action" | "diary_entry" | "source_item"
>;

export type EmbeddingVisibility = "normal" | "diary_private" | "sensitive" | "hidden";

export interface KnowledgeEmbeddingInput {
  readonly entityType: SemanticEntityType;
  readonly entityId: string;
  readonly label: string;
  readonly text: string;
  readonly visibility: EmbeddingVisibility;
  readonly ownerUserId: string | null;
}

interface ExistingEmbeddingRow {
  entity_type: string;
  entity_id: string;
  content_hash: string;
}

interface MatchRow {
  entity_type: string;
  entity_id: string;
  owner_user_id: string | null;
  visibility: string;
  similarity: number;
}

interface EntityLinkRow {
  id: string;
  status: string;
  confidence: number;
}

export interface SemanticCandidateInput {
  readonly sourceType: SemanticEntityType;
  readonly targetType: SemanticEntityType;
  readonly similarity: number;
}

export const SEMANTIC_LINK_MIN_SCORE = 0.78;

const ENTITY_ORDER: Record<SemanticEntityType, number> = {
  person: 10,
  company: 20,
  action: 30,
  diary_entry: 40,
  source_item: 50,
};

function clean(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function lines(parts: readonly (string | null | undefined | false)[]): string {
  return parts.map((part) => clean(part || "")).filter(Boolean).join("\n");
}

export function contentHashFor(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex");
}

export function canonicalKnowledgeText(input: {
  readonly entityType: SemanticEntityType;
  readonly label: string;
  readonly fields: readonly (string | null | undefined | false)[];
}): string {
  return lines([
    `Type: ${input.entityType}`,
    `Label: ${input.label}`,
    ...input.fields,
  ]);
}

function vectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.map((n) => Number(n).toFixed(8)).join(",")}]`;
}

function entityKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

function scoreBoost(sourceType: SemanticEntityType, targetType: SemanticEntityType): number {
  const pair = new Set([sourceType, targetType]);
  if (pair.has("person") && pair.has("company")) return 0.08;
  if (pair.has("person") && pair.has("action")) return 0.06;
  if (pair.has("company") && pair.has("action")) return 0.05;
  if (pair.has("diary_entry") && (pair.has("person") || pair.has("action"))) return 0.04;
  if (sourceType === targetType) return -0.04;
  return 0.02;
}

export function scoreSemanticCandidate(input: SemanticCandidateInput): number {
  const score = input.similarity + scoreBoost(input.sourceType, input.targetType);
  return Math.max(0, Math.min(0.99, Math.round(score * 1000) / 1000));
}

/**
 * A calm, operator-facing name for an entity whose real label could not be
 * resolved on this run (e.g. a neighbour that was embedded on a prior run but
 * now falls outside the current load window). Never expose a raw entity id in
 * operator-visible evidence copy — an id-prefix like "company 3f2a1b9c" leaks
 * internal detail and reads as broken (release-readiness copy bar).
 */
export function humanEntityLabel(entityType: string): string {
  switch (entityType) {
    case "person":
      return "a related person";
    case "company":
      return "a related company";
    case "action":
      return "a related action";
    case "diary_entry":
      return "a related diary entry";
    case "source_item":
      return "a related source item";
    default:
      return "a related item";
  }
}

/** Pure builder for the operator-facing evidence line on a semantic link. */
export function buildSemanticEvidence(
  sourceLabel: string,
  targetLabel: string,
  similarity: number,
): string {
  return (
    `${sourceLabel} and ${targetLabel} are semantically close ` +
    `(${Math.round(similarity * 100)}% vector similarity).`
  );
}

export function relationshipTypeFor(
  sourceType: SemanticEntityType,
  targetType: SemanticEntityType,
): string {
  const pair = new Set([sourceType, targetType]);
  if (pair.has("person") && pair.has("action")) return "action_owner";
  if (pair.has("source_item") || pair.has("diary_entry")) return "mentioned_with";
  return "semantically_related";
}

function canonicalEndpoints(
  source: Pick<KnowledgeEmbeddingInput, "entityType" | "entityId">,
  target: Pick<KnowledgeEmbeddingInput, "entityType" | "entityId">,
): {
  sourceType: SemanticEntityType;
  sourceId: string;
  targetType: SemanticEntityType;
  targetId: string;
} {
  const a = ENTITY_ORDER[source.entityType] - ENTITY_ORDER[target.entityType];
  if (a < 0 || (a === 0 && source.entityId < target.entityId)) {
    return {
      sourceType: source.entityType,
      sourceId: source.entityId,
      targetType: target.entityType,
      targetId: target.entityId,
    };
  }
  return {
    sourceType: target.entityType,
    sourceId: target.entityId,
    targetType: source.entityType,
    targetId: source.entityId,
  };
}

function linkVisibilityFor(
  source: Pick<KnowledgeEmbeddingInput, "visibility">,
  target: Pick<KnowledgeEmbeddingInput, "visibility">,
): LinkVisibility {
  if (source.visibility === "hidden" || target.visibility === "hidden") return "hidden";
  if (source.visibility === "diary_private" || target.visibility === "diary_private") return "sensitive";
  if (source.visibility === "sensitive" || target.visibility === "sensitive") return "sensitive";
  return "normal";
}

async function loadKnowledgeInputs(tenantId: string): Promise<KnowledgeEmbeddingInput[]> {
  const secret = createSupabaseSecretClient();
  const [
    sourceItems,
    summaries,
    diary,
    actions,
    people,
    personTags,
    companies,
    companyTags,
  ] = await Promise.all([
    secret
      .from("source_items")
      .select("id, system, title, body, author, occurred_at, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(300),
    secret
      .from("content_summaries")
      .select("source_item_id, summary, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(500),
    secret
      .from("diary_entries")
      .select("id, author_user_id, entry_type, kind, body, transcript, created_at, updated_at")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(300),
    secret
      .from("suggested_actions")
      .select("id, title, description, rationale, status, priority, topics, due_at, updated_at")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(300),
    secret
      .from("people")
      .select("id, display_name, role_title, organisation, relationship_type, importance_level, notes, updated_at")
      .eq("tenant_id", tenantId)
      .limit(500),
    secret.from("person_tags").select("person_id, tag").eq("tenant_id", tenantId),
    secret
      .from("companies")
      .select("id, name, relationship_type, importance_level, notes, updated_at")
      .eq("tenant_id", tenantId)
      .limit(500),
    secret.from("company_tags").select("company_id, tag").eq("tenant_id", tenantId),
  ]);

  for (const result of [sourceItems, summaries, diary, actions, people, personTags, companies, companyTags]) {
    if (result.error) throw new Error(result.error.message);
  }

  const summaryBySource = new Map<string, string>();
  for (const summary of summaries.data ?? []) {
    if (!summaryBySource.has(summary.source_item_id)) {
      summaryBySource.set(summary.source_item_id, summary.summary);
    }
  }

  const personTagsById = new Map<string, string[]>();
  for (const tag of personTags.data ?? []) {
    const list = personTagsById.get(tag.person_id) ?? [];
    list.push(tag.tag);
    personTagsById.set(tag.person_id, list);
  }

  const companyTagsById = new Map<string, string[]>();
  for (const tag of companyTags.data ?? []) {
    const list = companyTagsById.get(tag.company_id) ?? [];
    list.push(tag.tag);
    companyTagsById.set(tag.company_id, list);
  }

  const out: KnowledgeEmbeddingInput[] = [];
  for (const item of sourceItems.data ?? []) {
    const label = clean(item.title) || `${item.system} source item`;
    const summary = summaryBySource.get(item.id);
    const text = canonicalKnowledgeText({
      entityType: "source_item",
      label,
      fields: [
        `System: ${item.system}`,
        item.author ? `Author: ${item.author}` : null,
        item.occurred_at ? `Occurred: ${item.occurred_at}` : null,
        summary ? `Summary: ${summary}` : item.body ? `Body: ${item.body}` : null,
      ],
    });
    if (text.length > 40) {
      out.push({
        entityType: "source_item",
        entityId: item.id,
        label,
        text,
        visibility: "normal",
        ownerUserId: null,
      });
    }
  }

  for (const entry of diary.data ?? []) {
    const body = clean(entry.transcript) || clean(entry.body);
    if (!body) continue;
    out.push({
      entityType: "diary_entry",
      entityId: entry.id,
      label: `Diary entry ${entry.created_at}`,
      text: canonicalKnowledgeText({
        entityType: "diary_entry",
        label: `Diary entry ${entry.created_at}`,
        fields: [
          entry.entry_type ? `Entry type: ${entry.entry_type}` : null,
          entry.kind ? `Kind: ${entry.kind}` : null,
          `Full text: ${body}`,
        ],
      }),
      visibility: "diary_private",
      ownerUserId: entry.author_user_id,
    });
  }

  for (const action of actions.data ?? []) {
    const label = clean(action.title);
    if (!label) continue;
    out.push({
      entityType: "action",
      entityId: action.id,
      label,
      text: canonicalKnowledgeText({
        entityType: "action",
        label,
        fields: [
          action.description ? `Description: ${action.description}` : null,
          action.rationale ? `Rationale: ${action.rationale}` : null,
          action.status ? `Status: ${action.status}` : null,
          action.priority ? `Priority: ${action.priority}` : null,
          Array.isArray(action.topics) && action.topics.length > 0
            ? `Topics: ${action.topics.join(", ")}`
            : null,
          action.due_at ? `Due: ${action.due_at}` : null,
        ],
      }),
      visibility: "normal",
      ownerUserId: null,
    });
  }

  for (const person of people.data ?? []) {
    const label = clean(person.display_name);
    if (!label) continue;
    const tags = personTagsById.get(person.id) ?? [];
    out.push({
      entityType: "person",
      entityId: person.id,
      label,
      text: canonicalKnowledgeText({
        entityType: "person",
        label,
        fields: [
          person.role_title ? `Role: ${person.role_title}` : null,
          person.organisation ? `Organisation: ${person.organisation}` : null,
          person.relationship_type ? `Relationship: ${person.relationship_type}` : null,
          person.importance_level ? `Importance: ${person.importance_level}` : null,
          tags.length > 0 ? `Tags: ${tags.join(", ")}` : null,
          person.notes ? `Notes: ${person.notes}` : null,
        ],
      }),
      visibility: "normal",
      ownerUserId: null,
    });
  }

  for (const company of companies.data ?? []) {
    const label = clean(company.name);
    if (!label) continue;
    const tags = companyTagsById.get(company.id) ?? [];
    out.push({
      entityType: "company",
      entityId: company.id,
      label,
      text: canonicalKnowledgeText({
        entityType: "company",
        label,
        fields: [
          company.relationship_type ? `Relationship: ${company.relationship_type}` : null,
          company.importance_level ? `Importance: ${company.importance_level}` : null,
          tags.length > 0 ? `Tags: ${tags.join(", ")}` : null,
          company.notes ? `Notes: ${company.notes}` : null,
        ],
      }),
      visibility: "normal",
      ownerUserId: null,
    });
  }

  return out;
}

async function loadExistingHashes(
  tenantId: string,
  embeddingModel: string,
): Promise<Map<string, string>> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("knowledge_embeddings")
    .select("entity_type, entity_id, content_hash")
    .eq("tenant_id", tenantId)
    .eq("embedding_model", embeddingModel);
  if (error) throw new Error(error.message);
  const map = new Map<string, string>();
  for (const row of (data ?? []) as ExistingEmbeddingRow[]) {
    map.set(entityKey(row.entity_type, row.entity_id), row.content_hash);
  }
  return map;
}

async function upsertEmbeddings(
  tenantId: string,
  embeddingModel: string,
  inputs: readonly KnowledgeEmbeddingInput[],
  result: EmbedResult,
): Promise<void> {
  if (inputs.length === 0) return;
  const rows = inputs.map((input, index) => ({
    tenant_id: tenantId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    owner_user_id: input.ownerUserId,
    content_hash: contentHashFor(input.text),
    embedding_model: embeddingModel,
    embedding: result.embeddings[index],
    visibility: input.visibility,
  }));
  const secret = createSupabaseSecretClient();
  const { error } = await secret.from("knowledge_embeddings").upsert(rows, {
    onConflict: "tenant_id,entity_type,entity_id,embedding_model",
    ignoreDuplicates: false,
  });
  if (error) throw new Error(error.message);
}

async function upsertSuggestedSemanticLink(
  tenantId: string,
  source: KnowledgeEmbeddingInput,
  target: KnowledgeEmbeddingInput,
  score: number,
  similarity: number,
): Promise<boolean> {
  const secret = createSupabaseSecretClient();
  const endpoints = canonicalEndpoints(source, target);
  const relationshipType = relationshipTypeFor(source.entityType, target.entityType);

  const { data: existing, error: existingError } = await secret
    .from("entity_links")
    .select("id, status, confidence")
    .eq("tenant_id", tenantId)
    .eq("source_entity_type", endpoints.sourceType)
    .eq("source_entity_id", endpoints.sourceId)
    .eq("target_entity_type", endpoints.targetType)
    .eq("target_entity_id", endpoints.targetId)
    .eq("relationship_type", relationshipType)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  const existingRow = existing as EntityLinkRow | null;
  if (existingRow?.status === "confirmed" || existingRow?.status === "rejected") {
    return false;
  }

  const evidence = buildSemanticEvidence(source.label, target.label, similarity);
  const visibility = linkVisibilityFor(source, target);

  if (existingRow) {
    const { error } = await secret
      .from("entity_links")
      .update({
        confidence: Math.max(Number(existingRow.confidence), score),
        evidence_summary: evidence,
        source_reference: `semantic:${source.entityType}:${source.entityId}`,
        visibility,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", existingRow.id);
    if (error) throw new Error(error.message);
    return false;
  }

  const { error } = await secret.from("entity_links").insert({
    tenant_id: tenantId,
    source_entity_type: endpoints.sourceType,
    source_entity_id: endpoints.sourceId,
    target_entity_type: endpoints.targetType,
    target_entity_id: endpoints.targetId,
    relationship_type: relationshipType,
    confidence: score,
    origin: "system",
    status: "suggested",
    evidence_summary: evidence,
    source_reference: `semantic:${source.entityType}:${source.entityId}`,
    visibility,
  });
  if (error) throw new Error(error.message);
  return true;
}

async function generateSemanticLinks(
  tenantId: string,
  embeddingModel: string,
  sources: readonly KnowledgeEmbeddingInput[],
  embeddings: readonly (readonly number[])[],
  allInputs: readonly KnowledgeEmbeddingInput[],
): Promise<number> {
  const secret = createSupabaseSecretClient();
  // Label/visibility map keyed over EVERY loaded entity — not just the ones
  // re-embedded this run. Neighbours returned by the match RPC come from all
  // tenant embeddings, so a map built only from `sources` (changed rows) would
  // leave an unchanged neighbour without a real label and fabricate an id-prefix
  // one ("company 3f2a1b9c") straight into the persisted, operator-visible
  // evidence line.
  const byKey = new Map(
    allInputs.map((input) => [entityKey(input.entityType, input.entityId), input]),
  );
  let suggested = 0;

  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const embedding = embeddings[index];
    if (!source || !embedding) continue;

    const { data, error } = await secret.rpc("match_knowledge_embeddings", {
      p_tenant_id: tenantId,
      p_query_embedding: vectorLiteral(embedding),
      p_embedding_model: embeddingModel,
      p_excluded_entity_type: source.entityType,
      p_excluded_entity_id: source.entityId,
      p_match_count: 12,
    });
    if (error) throw new Error(error.message);

    for (const row of (data ?? []) as MatchRow[]) {
      const target =
        byKey.get(entityKey(row.entity_type, row.entity_id)) ??
        ({
          entityType: row.entity_type as SemanticEntityType,
          entityId: row.entity_id,
          // Neighbour is outside the current load window — fall back to a calm,
          // honest descriptor rather than leaking a raw id into evidence copy.
          label: humanEntityLabel(row.entity_type),
          text: "",
          visibility: row.visibility as EmbeddingVisibility,
          ownerUserId: row.owner_user_id,
        } satisfies KnowledgeEmbeddingInput);
      const similarity = Number(row.similarity);
      const score = scoreSemanticCandidate({
        sourceType: source.entityType,
        targetType: target.entityType,
        similarity,
      });
      if (score < SEMANTIC_LINK_MIN_SCORE) continue;
      if (await upsertSuggestedSemanticLink(tenantId, source, target, score, similarity)) {
        suggested += 1;
      }
    }
  }

  return suggested;
}

export interface SemanticLinkingResult {
  readonly embedded: number;
  readonly skipped: number;
  readonly suggestedLinks: number;
}

export interface SemanticLinkingService {
  processTenant(ctx: TenantContext): Promise<SemanticLinkingResult>;
}

export const semanticLinkingService: SemanticLinkingService = {
  async processTenant(ctx) {
    const embeddingModel = llmEmbeddingModel();
    const inputs = await loadKnowledgeInputs(ctx.tenantId);
    const existingHashes = await loadExistingHashes(ctx.tenantId, embeddingModel);
    const changed = inputs.filter(
      (input) => existingHashes.get(entityKey(input.entityType, input.entityId)) !== contentHashFor(input.text),
    );

    if (changed.length === 0) {
      return { embedded: 0, skipped: inputs.length, suggestedLinks: 0 };
    }

    const embedResult = await modelGateway.embed({
      ctx,
      dataClassification: "restricted",
      inputs: changed.map((input) => input.text),
      requestedModelId: embeddingModel,
      agentRunId: "semantic-linking",
    });
    if (!embedResult.ok) throw embedResult.error;

    await upsertEmbeddings(ctx.tenantId, embeddingModel, changed, embedResult.value);
    const suggestedLinks = await generateSemanticLinks(
      ctx.tenantId,
      embeddingModel,
      changed,
      embedResult.value.embeddings,
      inputs,
    );

    return {
      embedded: changed.length,
      skipped: inputs.length - changed.length,
      suggestedLinks,
    };
  },
};
