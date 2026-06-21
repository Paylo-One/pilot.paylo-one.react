import "server-only";

/**
 * modules/people/relationships.ts
 *
 * The relationship graph layer. Reads and writes `entity_links` — the
 * graph-ready, explainable edges connecting people, companies, topics, actions,
 * decisions, diary entries, briefings, and source items. Every edge carries its
 * kind, confidence, origin (system-suggested vs user-confirmed), an evidence
 * summary, and provenance, so any connection can be explained and, if proposed by
 * the system, confirmed or rejected by the operator (never auto-applied).
 *
 * RLS user client; inserts carry tenant_id (WITH CHECK validates it).
 *
 * Governance: docs/product/people-and-companies.md (Relationship graph model),
 * architecture/people-context-architecture.md.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  type EntityLink,
  type EntityType,
  type LinkOrigin,
  type LinkStatus,
  type LinkVisibility,
  type ResolvedRelationship,
  relationshipKindLabel,
} from "./people.types";

interface LinkRow {
  id: string;
  source_entity_type: string;
  source_entity_id: string;
  target_entity_type: string;
  target_entity_id: string;
  relationship_type: string;
  confidence: number;
  origin: string;
  status: string;
  evidence_summary: string | null;
  source_reference: string | null;
  visibility: string;
  first_seen_at: string;
  last_seen_at: string;
}

const LINK_COLS =
  "id, source_entity_type, source_entity_id, target_entity_type, target_entity_id, relationship_type, confidence, origin, status, evidence_summary, source_reference, visibility, first_seen_at, last_seen_at";

function mapLink(row: LinkRow): EntityLink {
  return {
    id: row.id,
    sourceType: row.source_entity_type as EntityType,
    sourceId: row.source_entity_id,
    targetType: row.target_entity_type as EntityType,
    targetId: row.target_entity_id,
    relationshipType: row.relationship_type,
    confidence: Number(row.confidence),
    origin: row.origin as LinkOrigin,
    status: row.status as LinkStatus,
    evidenceSummary: row.evidence_summary,
    sourceReference: row.source_reference,
    visibility: row.visibility as LinkVisibility,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

export interface UpsertLinkInput {
  sourceType: EntityType;
  sourceId: string;
  targetType: EntityType;
  targetId: string;
  relationshipType: string;
  confidence?: number;
  origin?: LinkOrigin;
  status?: LinkStatus;
  evidenceSummary?: string | null;
  sourceReference?: string | null;
  visibility?: LinkVisibility;
}

/**
 * Insert an edge, or — if the same edge (same endpoints + kind) already exists —
 * refresh it: bump `last_seen_at`, keep the higher confidence, and escalate a
 * suggestion to confirmed when the caller confirms it. Re-observation strengthens
 * an edge rather than duplicating it.
 */
export async function upsertEntityLink(
  tenantId: string,
  input: UpsertLinkInput,
): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("entity_links")
    .upsert(
      {
        tenant_id: tenantId,
        source_entity_type: input.sourceType,
        source_entity_id: input.sourceId,
        target_entity_type: input.targetType,
        target_entity_id: input.targetId,
        relationship_type: input.relationshipType,
        confidence: input.confidence ?? 0.5,
        origin: input.origin ?? "user",
        status: input.status ?? "confirmed",
        evidence_summary: input.evidenceSummary ?? null,
        source_reference: input.sourceReference ?? null,
        visibility: input.visibility ?? "normal",
        last_seen_at: new Date().toISOString(),
      },
      {
        onConflict:
          "tenant_id,source_entity_type,source_entity_id,target_entity_type,target_entity_id,relationship_type",
        ignoreDuplicates: false,
      },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "link_upsert_failed");
  return data.id as string;
}

/** Confirm a system-suggested edge (origin stays, status → confirmed). */
export async function confirmEntityLink(linkId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("entity_links")
    .update({ status: "confirmed", last_seen_at: new Date().toISOString() })
    .eq("id", linkId);
  if (error) throw new Error(error.message);
}

/** Reject a suggested edge (kept for the record, excluded from the graph). */
export async function rejectEntityLink(linkId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("entity_links")
    .update({ status: "rejected" })
    .eq("id", linkId);
  if (error) throw new Error(error.message);
}

/** Delete an edge outright (user-removed link). */
export async function deleteEntityLink(linkId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("entity_links").delete().eq("id", linkId);
  if (error) throw new Error(error.message);
}

// --- Label resolution -------------------------------------------------------

/**
 * Resolve display labels for person + company endpoints (the entities this pass's
 * graph centres on). Other endpoint types fall back to a typed short label; full
 * label resolution for topics/actions/decisions is a documented follow-up.
 */
async function resolveLabels(
  links: readonly EntityLink[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const personIds = new Set<string>();
  const companyIds = new Set<string>();
  for (const l of links) {
    if (l.sourceType === "person") personIds.add(l.sourceId);
    if (l.targetType === "person") personIds.add(l.targetId);
    if (l.sourceType === "company") companyIds.add(l.sourceId);
    if (l.targetType === "company") companyIds.add(l.targetId);
  }
  const supabase = await createSupabaseServerClient();
  if (personIds.size > 0) {
    const { data } = await supabase
      .from("people")
      .select("id, display_name")
      .in("id", [...personIds]);
    for (const p of (data ?? []) as { id: string; display_name: string }[]) {
      labels.set(`person:${p.id}`, p.display_name);
    }
  }
  if (companyIds.size > 0) {
    const { data } = await supabase
      .from("companies")
      .select("id, name")
      .in("id", [...companyIds]);
    for (const c of (data ?? []) as { id: string; name: string }[]) {
      labels.set(`company:${c.id}`, c.name);
    }
  }
  return labels;
}

async function filterReadableLinks(links: readonly EntityLink[]): Promise<EntityLink[]> {
  const visible = links.filter((link) => link.visibility !== "hidden");
  const diaryIds = new Set<string>();
  for (const link of visible) {
    if (link.sourceType === "diary_entry") diaryIds.add(link.sourceId);
    if (link.targetType === "diary_entry") diaryIds.add(link.targetId);
  }
  if (diaryIds.size === 0) return visible;

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;
  if (!userId) {
    return visible.filter((link) => link.sourceType !== "diary_entry" && link.targetType !== "diary_entry");
  }

  const { data } = await supabase
    .from("diary_entries")
    .select("id, author_user_id")
    .in("id", [...diaryIds]);
  const readableDiaryIds = new Set(
    ((data ?? []) as { id: string; author_user_id: string }[])
      .filter((entry) => entry.author_user_id === userId)
      .map((entry) => entry.id),
  );

  return visible.filter((link) => {
    const sourceDiary = link.sourceType === "diary_entry" ? link.sourceId : null;
    const targetDiary = link.targetType === "diary_entry" ? link.targetId : null;
    return (
      (!sourceDiary || readableDiaryIds.has(sourceDiary)) &&
      (!targetDiary || readableDiaryIds.has(targetDiary))
    );
  });
}

function resolveOther(
  link: EntityLink,
  forType: EntityType,
  forId: string,
  labels: Map<string, string>,
): ResolvedRelationship {
  const outgoing = link.sourceType === forType && link.sourceId === forId;
  const otherType = outgoing ? link.targetType : link.sourceType;
  const otherId = outgoing ? link.targetId : link.sourceId;
  const otherLabel =
    labels.get(`${otherType}:${otherId}`) ?? `${otherType} ${otherId.slice(0, 8)}`;
  return {
    id: link.id,
    otherType,
    otherId,
    otherLabel,
    relationshipType: link.relationshipType,
    relationshipLabel: relationshipKindLabel(link.relationshipType),
    confidence: link.confidence,
    origin: link.origin,
    status: link.status,
    evidenceSummary: link.evidenceSummary,
  };
}

export interface ListRelationshipsOptions {
  readonly includeSuggested?: boolean;
}

/** Relationships touching an entity (both directions), resolved. */
export async function listRelationshipsFor(
  entityType: EntityType,
  entityId: string,
  options: ListRelationshipsOptions = {},
): Promise<ResolvedRelationship[]> {
  const supabase = await createSupabaseServerClient();
  const statuses = options.includeSuggested ? ["confirmed", "suggested"] : ["confirmed"];
  const { data, error } = await supabase
    .from("entity_links")
    .select(LINK_COLS)
    .in("status", statuses)
    .or(
      `and(source_entity_type.eq.${entityType},source_entity_id.eq.${entityId}),and(target_entity_type.eq.${entityType},target_entity_id.eq.${entityId})`,
    );
  if (error) throw new Error(error.message);
  const links = await filterReadableLinks(((data ?? []) as LinkRow[]).map(mapLink));
  const labels = await resolveLabels(links);
  return links
    .map((l) => resolveOther(l, entityType, entityId, labels))
    .sort((a, b) => b.confidence - a.confidence);
}

/** Pending system-suggested edges, resolved for the correlation inbox. */
export async function listSuggestedLinks(): Promise<ResolvedRelationship[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("entity_links")
    .select(LINK_COLS)
    .eq("status", "suggested")
    .order("confidence", { ascending: false });
  if (error) throw new Error(error.message);
  const links = await filterReadableLinks(((data ?? []) as LinkRow[]).map(mapLink));
  const labels = await resolveLabels(links);
  // Present from the source endpoint's perspective.
  return links.map((l) => resolveOther(l, l.sourceType, l.sourceId, labels));
}

export interface GraphNode {
  readonly type: EntityType;
  readonly id: string;
  readonly label: string;
}

export interface RelationshipGraph {
  readonly root: GraphNode;
  readonly nodes: GraphNode[];
  readonly edges: ResolvedRelationship[];
}

/**
 * A one-hop, confirmed relationship graph around an entity, for the UI and MCP.
 * Bounded to confirmed, non-hidden edges. Deeper traversal is a documented
 * follow-up.
 */
export async function getRelationshipGraph(
  entityType: EntityType,
  entityId: string,
  rootLabel: string,
): Promise<RelationshipGraph> {
  const edges = await listRelationshipsFor(entityType, entityId);
  const nodes: GraphNode[] = edges.map((e) => ({
    type: e.otherType,
    id: e.otherId,
    label: e.otherLabel,
  }));
  return {
    root: { type: entityType, id: entityId, label: rootLabel },
    nodes,
    edges,
  };
}
