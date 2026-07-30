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

/**
 * Edit an existing edge (relationship kind and/or confidence). Editing is a
 * user act: the edge becomes user-owned and confirmed. Returns false when the
 * edge is not visible to the caller (RLS) or does not exist.
 */
export async function updateEntityLink(
  linkId: string,
  patch: { relationshipType?: string; confidence?: number },
): Promise<boolean> {
  const update: Record<string, unknown> = {
    origin: "user",
    status: "confirmed",
    last_seen_at: new Date().toISOString(),
  };
  if (patch.relationshipType !== undefined) update.relationship_type = patch.relationshipType;
  if (patch.confidence !== undefined) update.confidence = patch.confidence;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("entity_links")
    .update(update)
    .eq("id", linkId)
    .select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
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

// --- Curated suggestions (Suggestions tab) -----------------------------------

/**
 * A suggested edge resolved for the Suggestions tab: both endpoints labelled,
 * bucketed into the People or Companies section. `bucket: "other"` covers edges
 * touching neither (topic↔action etc.) — hidden behind "View more".
 */
export interface SuggestedConnection {
  readonly id: string;
  readonly sourceType: EntityType;
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly targetType: EntityType;
  readonly targetId: string;
  readonly targetLabel: string;
  readonly relationshipType: string;
  readonly relationshipLabel: string;
  readonly confidence: number;
  readonly evidenceSummary: string | null;
  readonly bucket: "people" | "companies" | "other";
}

export interface SuggestedConnectionsQuery {
  readonly bucket?: "people" | "companies" | "other";
  /** Case-insensitive match on endpoint labels + relationship label. */
  readonly query?: string;
  readonly relationshipType?: string;
  /** Hide matches below this confidence (default 0). */
  readonly minConfidence?: number;
  readonly offset?: number;
  readonly limit?: number;
}

export interface SuggestedConnectionsPage {
  readonly items: SuggestedConnection[];
  /** Matches for the given filters (before offset/limit). */
  readonly total: number;
}

/** Hard cap on suggested edges considered per read — never the whole backlog. */
const SUGGESTION_FETCH_CAP = 500;

function bucketFor(link: EntityLink): SuggestedConnection["bucket"] {
  if (link.sourceType === "company" || link.targetType === "company") return "companies";
  if (link.sourceType === "person" || link.targetType === "person") return "people";
  return "other";
}

/**
 * Resolve display labels for every endpoint type the suggestions touch —
 * unlike `resolveLabels`, this also gives source items, actions, and diary
 * entries a human title so evidence reads as plain language, and it excludes
 * archived people/companies (their key is simply absent from the map).
 */
async function resolveRichLabels(links: readonly EntityLink[]): Promise<Map<string, string>> {
  const idsByType = new Map<EntityType, Set<string>>();
  for (const l of links) {
    for (const [t, id] of [
      [l.sourceType, l.sourceId],
      [l.targetType, l.targetId],
    ] as const) {
      const set = idsByType.get(t) ?? new Set<string>();
      set.add(id);
      idsByType.set(t, set);
    }
  }

  const labels = new Map<string, string>();
  const supabase = await createSupabaseServerClient();
  // Supabase query builders are PromiseLike, not full Promises.
  const lookups: PromiseLike<void>[] = [];

  const personIds = idsByType.get("person");
  if (personIds?.size) {
    lookups.push(
      supabase
        .from("people")
        .select("id, display_name")
        .is("archived_at", null)
        .in("id", [...personIds])
        .then(({ data }) => {
          for (const p of (data ?? []) as { id: string; display_name: string }[]) {
            labels.set(`person:${p.id}`, p.display_name);
          }
        }),
    );
  }
  const companyIds = idsByType.get("company");
  if (companyIds?.size) {
    lookups.push(
      supabase
        .from("companies")
        .select("id, name")
        .is("archived_at", null)
        .in("id", [...companyIds])
        .then(({ data }) => {
          for (const c of (data ?? []) as { id: string; name: string }[]) {
            labels.set(`company:${c.id}`, c.name);
          }
        }),
    );
  }
  const itemIds = idsByType.get("source_item");
  if (itemIds?.size) {
    lookups.push(
      supabase
        .from("source_items")
        .select("id, title, system")
        .in("id", [...itemIds])
        .then(({ data }) => {
          for (const it of (data ?? []) as { id: string; title: string | null; system: string }[]) {
            labels.set(`source_item:${it.id}`, it.title?.trim() || `${it.system} message`);
          }
        }),
    );
  }
  const actionIds = idsByType.get("action");
  if (actionIds?.size) {
    lookups.push(
      supabase
        .from("suggested_actions")
        .select("id, title")
        .in("id", [...actionIds])
        .then(({ data }) => {
          for (const a of (data ?? []) as { id: string; title: string }[]) {
            labels.set(`action:${a.id}`, a.title);
          }
        }),
    );
  }
  const diaryIds = idsByType.get("diary_entry");
  if (diaryIds?.size) {
    lookups.push(
      supabase
        .from("diary_entries")
        .select("id, created_at")
        .in("id", [...diaryIds])
        .then(({ data }) => {
          for (const d of (data ?? []) as { id: string; created_at: string }[]) {
            labels.set(`diary_entry:${d.id}`, `Diary entry (${d.created_at.slice(0, 10)})`);
          }
        }),
    );
  }
  await Promise.all(lookups);
  return labels;
}

/**
 * Suggested connections for the Suggestions tab: capped, readable, endpoint
 * labels resolved, and filterable. Edges whose person/company endpoint is
 * archived (or gone) are dropped — a suggestion about a record you archived is
 * noise. Ordered by confidence, highest first.
 */
export async function listSuggestedConnections(
  queryOptions: SuggestedConnectionsQuery = {},
): Promise<SuggestedConnectionsPage> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("entity_links")
    .select(LINK_COLS)
    .eq("status", "suggested")
    .order("confidence", { ascending: false })
    .limit(SUGGESTION_FETCH_CAP);
  if (error) throw new Error(error.message);

  const links = await filterReadableLinks(((data ?? []) as LinkRow[]).map(mapLink));
  const labels = await resolveRichLabels(links);

  const all: SuggestedConnection[] = [];
  for (const l of links) {
    const sourceLabel = labels.get(`${l.sourceType}:${l.sourceId}`);
    const targetLabel = labels.get(`${l.targetType}:${l.targetId}`);
    // A person/company endpoint with no label is archived or deleted → drop.
    if ((l.sourceType === "person" || l.sourceType === "company") && !sourceLabel) continue;
    if ((l.targetType === "person" || l.targetType === "company") && !targetLabel) continue;
    all.push({
      id: l.id,
      sourceType: l.sourceType,
      sourceId: l.sourceId,
      sourceLabel: sourceLabel ?? `${l.sourceType} ${l.sourceId.slice(0, 8)}`,
      targetType: l.targetType,
      targetId: l.targetId,
      targetLabel: targetLabel ?? `${l.targetType} ${l.targetId.slice(0, 8)}`,
      relationshipType: l.relationshipType,
      relationshipLabel: relationshipKindLabel(l.relationshipType),
      confidence: l.confidence,
      evidenceSummary: l.evidenceSummary,
      bucket: bucketFor(l),
    });
  }

  const q = queryOptions.query?.trim().toLowerCase();
  const minConfidence = queryOptions.minConfidence ?? 0;
  const filtered = all.filter((s) => {
    if (queryOptions.bucket && s.bucket !== queryOptions.bucket) return false;
    if (queryOptions.relationshipType && s.relationshipType !== queryOptions.relationshipType) return false;
    if (s.confidence < minConfidence) return false;
    if (!q) return true;
    return `${s.sourceLabel} ${s.targetLabel} ${s.relationshipLabel}`.toLowerCase().includes(q);
  });

  const offset = queryOptions.offset ?? 0;
  const limit = queryOptions.limit ?? 20;
  return { items: filtered.slice(offset, offset + limit), total: filtered.length };
}

export interface CuratedSuggestions {
  readonly people: SuggestedConnection[];
  readonly companies: SuggestedConnection[];
  readonly totals: {
    readonly people: number;
    readonly companies: number;
    readonly other: number;
  };
}

/** How many suggestions each curated section leads with. */
const CURATED_LIMIT = 6;
/** Suggestions below this stay behind "View more" (low-context noise). */
const CURATED_MIN_CONFIDENCE = 0.85;
/** Always surface at least this many per section when any exist at all. */
const CURATED_FLOOR = 3;

/**
 * The Suggestions tab's default view: a small set of high-confidence people
 * and company suggestions (instead of the whole semantic backlog), plus totals
 * so the UI can offer "View more". One capped read serves both sections.
 */
export async function getCuratedSuggestions(): Promise<CuratedSuggestions> {
  const { items } = await listSuggestedConnections({ limit: SUGGESTION_FETCH_CAP });

  const byBucket = { people: [] as SuggestedConnection[], companies: [] as SuggestedConnection[], other: [] as SuggestedConnection[] };
  for (const s of items) byBucket[s.bucket].push(s);

  const curate = (list: SuggestedConnection[]): SuggestedConnection[] => {
    const confident = list.filter((s) => s.confidence >= CURATED_MIN_CONFIDENCE).slice(0, CURATED_LIMIT);
    // Items are already confidence-ordered, so the floor is just the head.
    return confident.length >= CURATED_FLOOR ? confident : list.slice(0, CURATED_FLOOR);
  };

  return {
    people: curate(byBucket.people),
    companies: curate(byBucket.companies),
    totals: {
      people: byBucket.people.length,
      companies: byBucket.companies.length,
      other: byBucket.other.length,
    },
  };
}

// --- People network (Connections tab) ----------------------------------------

export interface NetworkNode {
  /** `${type}:${id}` — stable key shared with edges. */
  readonly key: string;
  readonly type: "person" | "company";
  readonly id: string;
  readonly label: string;
  readonly importance: string;
  readonly isSelf: boolean;
  /** Confirmed edges touching this node. */
  readonly degree: number;
}

export interface NetworkEdge {
  readonly id: string;
  readonly sourceKey: string;
  readonly targetKey: string;
  readonly relationshipType: string;
  readonly relationshipLabel: string;
  readonly confidence: number;
  readonly origin: LinkOrigin;
  readonly evidenceSummary: string | null;
}

export interface PeopleNetwork {
  readonly nodes: NetworkNode[];
  readonly edges: NetworkEdge[];
}

/** Hard cap on graph edges shipped to the Connections tab. */
const NETWORK_EDGE_CAP = 1500;

/**
 * The confirmed person/company relationship network for the Connections tab.
 * Every active person and company is a node (so search can reveal anyone);
 * edges are confirmed person↔person / person↔company / company↔company links,
 * strongest first, capped. Archived records are excluded entirely.
 */
export async function getPeopleNetwork(): Promise<PeopleNetwork> {
  const supabase = await createSupabaseServerClient();
  const [{ data: linkData, error: linkErr }, { data: peopleData, error: pErr }, { data: companyData, error: cErr }] =
    await Promise.all([
      supabase
        .from("entity_links")
        .select(LINK_COLS)
        .eq("status", "confirmed")
        .in("source_entity_type", ["person", "company"])
        .in("target_entity_type", ["person", "company"])
        .order("confidence", { ascending: false })
        .limit(NETWORK_EDGE_CAP),
      supabase
        .from("people")
        .select("id, display_name, importance_level, is_self")
        .is("archived_at", null),
      supabase.from("companies").select("id, name, importance_level").is("archived_at", null),
    ]);
  if (linkErr) throw new Error(linkErr.message);
  if (pErr) throw new Error(pErr.message);
  if (cErr) throw new Error(cErr.message);

  const nodesByKey = new Map<string, { type: "person" | "company"; id: string; label: string; importance: string; isSelf: boolean; degree: number }>();
  for (const p of (peopleData ?? []) as { id: string; display_name: string; importance_level: string; is_self: boolean }[]) {
    nodesByKey.set(`person:${p.id}`, {
      type: "person",
      id: p.id,
      label: p.display_name,
      importance: p.importance_level,
      isSelf: p.is_self,
      degree: 0,
    });
  }
  for (const c of (companyData ?? []) as { id: string; name: string; importance_level: string }[]) {
    nodesByKey.set(`company:${c.id}`, {
      type: "company",
      id: c.id,
      label: c.name,
      importance: c.importance_level,
      isSelf: false,
      degree: 0,
    });
  }

  const links = ((linkData ?? []) as LinkRow[]).map(mapLink).filter((l) => l.visibility !== "hidden");
  const edges: NetworkEdge[] = [];
  for (const l of links) {
    const sourceKey = `${l.sourceType}:${l.sourceId}`;
    const targetKey = `${l.targetType}:${l.targetId}`;
    const source = nodesByKey.get(sourceKey);
    const target = nodesByKey.get(targetKey);
    if (!source || !target || sourceKey === targetKey) continue; // archived/unknown endpoint
    source.degree += 1;
    target.degree += 1;
    edges.push({
      id: l.id,
      sourceKey,
      targetKey,
      relationshipType: l.relationshipType,
      relationshipLabel: relationshipKindLabel(l.relationshipType),
      confidence: l.confidence,
      origin: l.origin,
      evidenceSummary: l.evidenceSummary,
    });
  }

  const nodes: NetworkNode[] = [...nodesByKey.entries()].map(([key, n]) => ({ key, ...n }));
  return { nodes, edges };
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
