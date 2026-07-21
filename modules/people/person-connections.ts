import "server-only";

/**
 * modules/people/person-connections.ts
 *
 * The person↔person connection pipeline. Gathers deterministic evidence
 * (direct interaction, co-occurrence, shared company — see
 * connection-evidence.ts), adds profile-embedding similarity as a supporting
 * signal, scores each pair with the documented weighted model
 * (connection-scoring.ts), and writes explainable suggested edges to
 * `entity_links` with their structured evidence.
 *
 * Operator decisions are never overwritten: rejected pairs are left alone,
 * confirmed pairs only get their evidence refreshed. One edge per pair — the
 * relationship kind follows the dominant evidence and is updated in place.
 *
 * Secret client with explicit tenant_id scoping on every query (job + server
 * action contexts). Governance: docs/architecture/connection-scoring.md.
 */

import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import {
  collectPairEvidence,
  pairKey,
  type EvidenceItem,
} from "./connection-evidence";
import {
  CONNECTION_SCORING,
  scoreConnection,
  type ConnectionEvidence,
} from "./connection-scoring";
import type { Person } from "./people.types";

/** How far back observed activity counts as evidence (decay handles the rest). */
const EVIDENCE_WINDOW_DAYS = 180;
const EVIDENCE_ITEM_LIMIT = 4000;

interface PersonRowLite {
  id: string;
  display_name: string;
  organisation: string | null;
  company_id: string | null;
  status: string;
  is_self: boolean;
}

interface IdentityRowLite {
  person_id: string;
  identity_type: string;
  identity_value: string;
}

/** Minimal Person shells for evidence extraction (no signals/tags needed). */
async function loadPeopleLite(tenantId: string): Promise<Person[]> {
  const secret = createSupabaseSecretClient();
  const [peopleRes, idRes, companyRes] = await Promise.all([
    secret
      .from("people")
      .select("id, display_name, organisation, company_id, status, is_self")
      .eq("tenant_id", tenantId),
    secret
      .from("person_identities")
      .select("person_id, identity_type, identity_value")
      .eq("tenant_id", tenantId),
    secret.from("companies").select("id, name").eq("tenant_id", tenantId),
  ]);
  for (const res of [peopleRes, idRes, companyRes]) {
    if (res.error) throw new Error(res.error.message);
  }
  const companyNames = new Map(
    ((companyRes.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  );
  const identities = new Map<string, IdentityRowLite[]>();
  for (const row of (idRes.data ?? []) as IdentityRowLite[]) {
    const list = identities.get(row.person_id) ?? [];
    list.push(row);
    identities.set(row.person_id, list);
  }
  return ((peopleRes.data ?? []) as PersonRowLite[]).map((row) => {
    const ids = identities.get(row.id) ?? [];
    return {
      id: row.id,
      displayName: row.display_name,
      roleTitle: null,
      organisation: row.organisation,
      companyId: row.company_id,
      companyName: row.company_id ? companyNames.get(row.company_id) ?? null : null,
      relationshipType: "other",
      importance: "normal",
      status: (row.status === "inactive" ? "inactive" : "active") as Person["status"],
      isSelf: row.is_self,
      emails: ids.filter((i) => i.identity_type === "email").map((i) => i.identity_value),
      phones: [],
      tags: [],
      notes: null,
      identities: ids.map((i) => ({
        id: `${row.id}:${i.identity_type}:${i.identity_value}`,
        personId: row.id,
        sourceType: "generic" as const,
        identityType: i.identity_type as Person["identities"][number]["identityType"],
        identityValue: i.identity_value,
        providerUserId: null,
        confidence: 1,
        verifiedByUser: true,
      })),
      relationships: [],
      signals: [],
      linkedActions: [],
      createdAt: "",
      updatedAt: "",
    } satisfies Person;
  });
}

async function loadRecentItems(tenantId: string, now: Date): Promise<EvidenceItem[]> {
  const secret = createSupabaseSecretClient();
  const since = new Date(now.getTime() - EVIDENCE_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await secret
    .from("source_items")
    .select("id, system, title, body, author, occurred_at")
    .eq("tenant_id", tenantId)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(EVIDENCE_ITEM_LIMIT);
  if (error) throw new Error(error.message);
  return ((data ?? []) as {
    id: string;
    system: string;
    title: string | null;
    body: string | null;
    author: string | null;
    occurred_at: string | null;
  }[]).map((r) => ({
    id: r.id,
    system: r.system,
    title: r.title,
    body: r.body,
    author: r.author,
    occurredAt: r.occurred_at,
  }));
}

function parseVector(value: unknown): number[] | null {
  if (Array.isArray(value)) return value as number[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as number[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length && i < b.length; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Pairwise profile similarity from stored person embeddings. Supporting signal
 * only; pairs below the semantic floor are omitted entirely.
 */
async function loadProfileSimilarity(tenantId: string): Promise<Map<string, number>> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("knowledge_embeddings")
    .select("entity_id, embedding")
    .eq("tenant_id", tenantId)
    .eq("entity_type", "person");
  if (error) throw new Error(error.message);
  const vectors: { id: string; vector: number[] }[] = [];
  for (const row of (data ?? []) as { entity_id: string; embedding: unknown }[]) {
    const vector = parseVector(row.embedding);
    if (vector) vectors.push({ id: row.entity_id, vector });
  }
  const out = new Map<string, number>();
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      const a = vectors[i] as { id: string; vector: number[] };
      const b = vectors[j] as { id: string; vector: number[] };
      const similarity = cosine(a.vector, b.vector);
      if (similarity >= CONNECTION_SCORING.semanticFloor) {
        out.set(pairKey(a.id, b.id), similarity);
      }
    }
  }
  return out;
}

interface ExistingLinkRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  status: string;
}

export interface PersonConnectionsResult {
  readonly pairsEvaluated: number;
  readonly created: number;
  readonly updated: number;
  readonly hidden: number;
  readonly skippedDecided: number;
}

/**
 * Recompute person↔person connection suggestions for a tenant. Idempotent;
 * safe to run after every sync or on demand from the People surface.
 */
export async function recomputePersonConnections(
  tenantId: string,
  now: Date = new Date(),
): Promise<PersonConnectionsResult> {
  const secret = createSupabaseSecretClient();
  const [people, items, profileSimilarity] = await Promise.all([
    loadPeopleLite(tenantId),
    loadRecentItems(tenantId, now),
    loadProfileSimilarity(tenantId),
  ]);

  const pairs = collectPairEvidence({ people, items, profileSimilarity });

  // One edge per pair, regardless of relationship kind: index existing edges.
  const { data: existingData, error: existingError } = await secret
    .from("entity_links")
    .select("id, source_entity_id, target_entity_id, relationship_type, status")
    .eq("tenant_id", tenantId)
    .eq("source_entity_type", "person")
    .eq("target_entity_type", "person");
  if (existingError) throw new Error(existingError.message);
  const existingByPair = new Map<string, ExistingLinkRow>();
  for (const row of (existingData ?? []) as ExistingLinkRow[]) {
    existingByPair.set(pairKey(row.source_entity_id, row.target_entity_id), row);
  }

  const result = { pairsEvaluated: pairs.length, created: 0, updated: 0, hidden: 0, skippedDecided: 0 };

  for (const pair of pairs) {
    const score = scoreConnection(pair.evidence as ConnectionEvidence, now);
    const key = pairKey(pair.personAId, pair.personBId);
    const existing = existingByPair.get(key);

    if (existing?.status === "rejected") {
      result.skippedDecided += 1;
      continue;
    }

    const evidencePayload = {
      confidence: score.score,
      evidence: { signals: pair.evidence.signals },
      evidence_count: score.evidenceCount,
      evidence_summary: score.headline,
      score_version: CONNECTION_SCORING.version,
      computed_at: now.toISOString(),
      last_seen_at: now.toISOString(),
    };

    if (existing?.status === "confirmed") {
      // Refresh the explanation, never the operator's decision or confidence.
      const { error } = await secret
        .from("entity_links")
        .update({
          evidence: evidencePayload.evidence,
          evidence_count: evidencePayload.evidence_count,
          score_version: evidencePayload.score_version,
          computed_at: evidencePayload.computed_at,
        })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      result.skippedDecided += 1;
      continue;
    }

    if (score.tier === "hidden") {
      if (existing) {
        // Existing suggestion no longer clears the bar: keep it, lower the
        // score so the read path stops surfacing it.
        const { error } = await secret
          .from("entity_links")
          .update(evidencePayload)
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
      }
      result.hidden += 1;
      continue;
    }

    if (existing) {
      const { error } = await secret
        .from("entity_links")
        .update({ ...evidencePayload, relationship_type: score.relationshipType })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      result.updated += 1;
    } else {
      const { error } = await secret.from("entity_links").insert({
        tenant_id: tenantId,
        source_entity_type: "person",
        source_entity_id: pair.personAId,
        target_entity_type: "person",
        target_entity_id: pair.personBId,
        relationship_type: score.relationshipType,
        origin: "system",
        status: "suggested",
        visibility: "normal",
        ...evidencePayload,
      });
      if (error) throw new Error(error.message);
      result.created += 1;
    }
  }

  return result;
}
