import "server-only";

/**
 * modules/people/people-server.ts
 *
 * Server-only data layer for People Context. Reads/writes use the RLS USER
 * client so tenant isolation is enforced by policy automatically; inserts set
 * `tenant_id` explicitly (WITH CHECK validates it against the caller's tenant).
 *
 * Persists `people` + `person_identities` + `person_tags`. Emails/phones are
 * modelled as `generic` identities (so correlation can match on them). Signals,
 * relationships, and linked actions are derived from the (not-yet-wired)
 * correlation pipeline and return empty for now.
 *
 * Governance: services/people-context-service.md, architecture/people-context-architecture.md.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SourceSystem } from "@/modules/shared";
import type {
  IdentityType,
  Person,
  PersonIdentity,
  PersonImportanceLevel,
  PersonLinkSuggestion,
  PersonStatus,
  RelationshipType,
  SourceMappingSourceType,
} from "./people.types";
import {
  correlateSourceItems,
  type CorrelationItem,
} from "./correlation";

// --- Row shapes + mapping ---------------------------------------------------

interface PersonRow {
  id: string;
  display_name: string;
  role_title: string | null;
  organisation: string | null;
  relationship_type: string;
  importance_level: string;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
interface IdentityRow {
  id: string;
  person_id: string;
  source_type: string;
  identity_type: string;
  identity_value: string;
  provider_user_id: string | null;
  confidence: number;
  verified_by_user: boolean;
}
interface TagRow {
  person_id: string;
  tag: string;
}

const PEOPLE_COLS =
  "id, display_name, role_title, organisation, relationship_type, importance_level, status, notes, created_at, updated_at";
const IDENTITY_COLS =
  "id, person_id, source_type, identity_type, identity_value, provider_user_id, confidence, verified_by_user";
const TAG_COLS = "person_id, tag";

function mapIdentity(row: IdentityRow): PersonIdentity {
  return {
    id: row.id,
    personId: row.person_id,
    sourceType: row.source_type as SourceMappingSourceType,
    identityType: row.identity_type as IdentityType,
    identityValue: row.identity_value,
    providerUserId: row.provider_user_id,
    confidence: Number(row.confidence),
    verifiedByUser: row.verified_by_user,
  };
}

function assemble(
  row: PersonRow,
  identities: PersonIdentity[],
  tags: string[],
): Person {
  return {
    id: row.id,
    displayName: row.display_name,
    roleTitle: row.role_title,
    organisation: row.organisation,
    relationshipType: row.relationship_type as RelationshipType,
    importance: row.importance_level as PersonImportanceLevel,
    status: row.status as PersonStatus,
    emails: identities.filter((i) => i.identityType === "email").map((i) => i.identityValue),
    phones: identities.filter((i) => i.identityType === "phone").map((i) => i.identityValue),
    tags,
    notes: row.notes,
    identities,
    // Derived from the correlation pipeline (not yet wired) — empty for now.
    relationships: [],
    signals: [],
    linkedActions: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Reads ------------------------------------------------------------------

/** Build the tenant's people with identities + tags (signals empty). */
async function loadBasePeople(): Promise<Person[]> {
  const supabase = await createSupabaseServerClient();

  const { data: peopleData, error: peopleErr } = await supabase
    .from("people")
    .select(PEOPLE_COLS)
    .order("display_name", { ascending: true });
  if (peopleErr) throw new Error(peopleErr.message);
  const peopleRows = (peopleData ?? []) as PersonRow[];
  if (peopleRows.length === 0) return [];

  const [{ data: idData, error: idErr }, { data: tagData, error: tagErr }] =
    await Promise.all([
      supabase.from("person_identities").select(IDENTITY_COLS),
      supabase.from("person_tags").select(TAG_COLS),
    ]);
  if (idErr) throw new Error(idErr.message);
  if (tagErr) throw new Error(tagErr.message);

  const identitiesByPerson = new Map<string, PersonIdentity[]>();
  for (const row of (idData ?? []) as IdentityRow[]) {
    const list = identitiesByPerson.get(row.person_id) ?? [];
    list.push(mapIdentity(row));
    identitiesByPerson.set(row.person_id, list);
  }
  const tagsByPerson = new Map<string, string[]>();
  for (const row of (tagData ?? []) as TagRow[]) {
    const list = tagsByPerson.get(row.person_id) ?? [];
    list.push(row.tag);
    tagsByPerson.set(row.person_id, list);
  }

  return peopleRows.map((row) =>
    assemble(row, identitiesByPerson.get(row.id) ?? [], tagsByPerson.get(row.id) ?? []),
  );
}

/** Tenant-owned people records without running source-item correlation. */
export async function listPeopleDirectory(): Promise<Person[]> {
  return loadBasePeople();
}

// --- Correlation reads ------------------------------------------------------

interface SourceItemRow {
  id: string;
  system: string;
  title: string | null;
  body: string | null;
  author: string | null;
  occurred_at: string | null;
  created_at: string;
}
const SOURCE_ITEM_COLS = "id, system, title, body, author, occurred_at, created_at";

/** Recent ingested items for correlation (RLS user client; bounded). */
async function listRecentItemsForCorrelation(limit = 200): Promise<CorrelationItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("source_items")
    .select(SOURCE_ITEM_COLS)
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as SourceItemRow[]).map((r) => ({
    id: r.id,
    system: r.system as SourceSystem,
    title: r.title,
    body: r.body,
    author: r.author,
    occurredAt: r.occurred_at ?? r.created_at,
  }));
}

/**
 * List people with **correlated signals** attached — recent ingested items
 * confidently attributed to each person (deterministic, verified-exact match).
 * Uncertain matches become suggestions (see `listLinkSuggestions`), not signals.
 */
export async function listPeople(): Promise<Person[]> {
  const [people, items] = await Promise.all([
    loadBasePeople(),
    listRecentItemsForCorrelation(),
  ]);
  const { signalsByPerson } = correlateSourceItems(items, people);
  return people.map((p) => ({ ...p, signals: signalsByPerson[p.id] ?? [] }));
}

// --- Link suggestions (persisted, confirmable) ------------------------------

interface SuggestionRow {
  id: string;
  source_item_id: string | null;
  source_system: string | null;
  observed_identity: string;
  candidate_person_id: string | null;
  confidence: number;
  reason: string | null;
  signal_preview: string | null;
}
const SUGGESTION_COLS =
  "id, source_item_id, source_system, observed_identity, candidate_person_id, confidence, reason, signal_preview";

/** List pending "is this the same person?" suggestions (RLS user client). */
export async function listLinkSuggestions(): Promise<PersonLinkSuggestion[]> {
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, { data: pData, error: pErr }] = await Promise.all([
    supabase.from("person_link_suggestions").select(SUGGESTION_COLS).eq("status", "pending"),
    supabase.from("people").select("id, display_name"),
  ]);
  if (error) throw new Error(error.message);
  if (pErr) throw new Error(pErr.message);
  const names = new Map<string, string>();
  for (const p of (pData ?? []) as { id: string; display_name: string }[]) {
    names.set(p.id, p.display_name);
  }
  return ((data ?? []) as SuggestionRow[]).map((r) => ({
    id: r.id,
    signalPreview: r.signal_preview ?? r.observed_identity,
    sourceSystem: (r.source_system as SourceSystem) ?? "email",
    observedIdentity: r.observed_identity,
    candidatePersonId: r.candidate_person_id,
    candidateName: r.candidate_person_id ? names.get(r.candidate_person_id) ?? null : null,
    confidence: Number(r.confidence),
    reason: r.reason ?? "",
  }));
}

/**
 * Run correlation over recent items and persist NEW pending suggestions for
 * uncertain/unknown senders. Skips observed identities that already have a
 * suggestion in any status (so resolved ones aren't re-proposed). RLS user
 * client; inserts carry tenant_id. Returns how many were added.
 */
export async function generateLinkSuggestions(tenantId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const [people, items] = await Promise.all([
    loadBasePeople(),
    listRecentItemsForCorrelation(),
  ]);
  const { suggestions } = correlateSourceItems(items, people);
  if (suggestions.length === 0) return 0;

  const { data: existing, error: exErr } = await supabase
    .from("person_link_suggestions")
    .select("observed_identity");
  if (exErr) throw new Error(exErr.message);
  const seen = new Set(
    ((existing ?? []) as { observed_identity: string }[]).map((e) =>
      e.observed_identity.toLowerCase(),
    ),
  );

  const rows = suggestions
    .filter((s) => !seen.has(s.observedIdentity.toLowerCase()))
    .map((s) => ({
      tenant_id: tenantId,
      source_item_id: s.sourceItemId,
      source_system: s.sourceSystem,
      observed_identity: s.observedIdentity,
      candidate_person_id: s.candidatePersonId,
      confidence: s.confidence,
      reason: s.reason,
      signal_preview: s.signalPreview,
      status: "pending",
    }));
  if (rows.length === 0) return 0;

  const { data, error } = await supabase
    .from("person_link_suggestions")
    .insert(rows)
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** Map a source system to the identity (source_type, identity_type) it implies. */
function identityForSystem(system: string): { sourceType: SourceMappingSourceType; identityType: IdentityType } {
  switch (system) {
    case "github": return { sourceType: "github", identityType: "github" };
    case "whatsapp": return { sourceType: "whatsapp", identityType: "whatsapp" };
    case "teams": return { sourceType: "teams", identityType: "teams" };
    case "slack": return { sourceType: "slack", identityType: "slack" };
    case "discord": return { sourceType: "discord", identityType: "discord" };
    case "notion": return { sourceType: "notion", identityType: "notion" };
    default: return { sourceType: "generic", identityType: "email" };
  }
}

async function readSuggestion(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, id: string) {
  const { data, error } = await supabase
    .from("person_link_suggestions")
    .select(SUGGESTION_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as SuggestionRow | null;
}

/**
 * Confirm a suggestion: lock the observed identity onto the candidate person as
 * a **verified** identity (so the item resolves as a signal next time), mark the
 * suggestion confirmed, and record correlation feedback.
 */
export async function confirmSuggestion(tenantId: string, suggestionId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const s = await readSuggestion(supabase, suggestionId);
  if (!s || !s.candidate_person_id) return false;
  const { sourceType, identityType } = identityForSystem(s.source_system ?? "email");

  await supabase.from("person_identities").upsert(
    {
      tenant_id: tenantId,
      person_id: s.candidate_person_id,
      source_type: sourceType,
      identity_type: identityType,
      identity_value: s.observed_identity,
      confidence: 1,
      verified_by_user: true,
    },
    { onConflict: "tenant_id,source_type,identity_value", ignoreDuplicates: false },
  );
  await supabase.from("person_link_suggestions").update({ status: "confirmed" }).eq("id", suggestionId);
  await supabase.from("correlation_feedback").insert({
    tenant_id: tenantId,
    source_item_id: s.source_item_id,
    proposed_person_id: s.candidate_person_id,
    corrected_person_id: s.candidate_person_id,
    verdict: "correct",
  });
  return true;
}

/** Reject a suggestion (not a match) + record feedback. */
export async function rejectSuggestion(tenantId: string, suggestionId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const s = await readSuggestion(supabase, suggestionId);
  if (!s) return false;
  await supabase.from("person_link_suggestions").update({ status: "rejected" }).eq("id", suggestionId);
  await supabase.from("correlation_feedback").insert({
    tenant_id: tenantId,
    source_item_id: s.source_item_id,
    proposed_person_id: s.candidate_person_id,
    corrected_person_id: null,
    verdict: "wrong",
  });
  return true;
}

/**
 * Create a new person from a suggestion (named after the observed identity),
 * attach the observed identity as verified, mark the suggestion resolved, and
 * record feedback.
 */
export async function newPersonFromSuggestion(tenantId: string, suggestionId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const s = await readSuggestion(supabase, suggestionId);
  if (!s) return null;
  const { sourceType, identityType } = identityForSystem(s.source_system ?? "email");

  const personId = await createPerson(tenantId, { displayName: s.observed_identity });
  await supabase.from("person_identities").insert({
    tenant_id: tenantId,
    person_id: personId,
    source_type: sourceType,
    identity_type: identityType,
    identity_value: s.observed_identity,
    confidence: 1,
    verified_by_user: true,
  });
  await supabase.from("person_link_suggestions").update({ status: "new_person" }).eq("id", suggestionId);
  await supabase.from("correlation_feedback").insert({
    tenant_id: tenantId,
    source_item_id: s.source_item_id,
    proposed_person_id: s.candidate_person_id,
    corrected_person_id: personId,
    verdict: "new_person",
  });
  return personId;
}

// --- Writes -----------------------------------------------------------------

export interface CreatePersonInput {
  displayName: string;
  roleTitle?: string | null;
  organisation?: string | null;
  relationshipType?: RelationshipType;
  importance?: PersonImportanceLevel;
  notes?: string | null;
  emails?: string[];
  phones?: string[];
  tags?: string[];
}

/** Create a person + their email/phone identities + tags (RLS user client). */
export async function createPerson(
  tenantId: string,
  input: CreatePersonInput,
): Promise<string> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("people")
    .insert({
      tenant_id: tenantId,
      display_name: input.displayName,
      role_title: input.roleTitle ?? null,
      organisation: input.organisation ?? null,
      relationship_type: input.relationshipType ?? "other",
      importance_level: input.importance ?? "normal",
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "person_create_failed");
  const personId = data.id as string;

  const identityRows = [
    ...(input.emails ?? []).filter(Boolean).map((email) => ({
      tenant_id: tenantId,
      person_id: personId,
      source_type: "generic",
      identity_type: "email",
      identity_value: email.trim(),
      confidence: 1,
      verified_by_user: true,
    })),
    ...(input.phones ?? []).filter(Boolean).map((phone) => ({
      tenant_id: tenantId,
      person_id: personId,
      source_type: "generic",
      identity_type: "phone",
      identity_value: phone.trim(),
      confidence: 1,
      verified_by_user: true,
    })),
  ];
  if (identityRows.length > 0) {
    const { error: idErr } = await supabase.from("person_identities").insert(identityRows);
    if (idErr) throw new Error(idErr.message);
  }

  const tagRows = (input.tags ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .map((tag) => ({ tenant_id: tenantId, person_id: personId, tag }));
  if (tagRows.length > 0) {
    const { error: tagErr } = await supabase.from("person_tags").insert(tagRows);
    if (tagErr) throw new Error(tagErr.message);
  }

  return personId;
}

export interface UpdatePersonPatch {
  displayName?: string;
  roleTitle?: string | null;
  organisation?: string | null;
  relationshipType?: RelationshipType;
  importance?: PersonImportanceLevel;
  status?: PersonStatus;
  notes?: string | null;
}

/** Update a person's core fields (RLS user client). */
export async function updatePerson(
  personId: string,
  patch: UpdatePersonPatch,
): Promise<boolean> {
  const update: Record<string, unknown> = {};
  if (patch.displayName !== undefined) update.display_name = patch.displayName;
  if (patch.roleTitle !== undefined) update.role_title = patch.roleTitle;
  if (patch.organisation !== undefined) update.organisation = patch.organisation;
  if (patch.relationshipType !== undefined) update.relationship_type = patch.relationshipType;
  if (patch.importance !== undefined) update.importance_level = patch.importance;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (Object.keys(update).length === 0) return false;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("people")
    .update(update)
    .eq("id", personId)
    .select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

/** Delete a person (cascades to identities/tags via FK). */
export async function deletePerson(personId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("people").delete().eq("id", personId);
  if (error) throw new Error(error.message);
}

/** Add a source identity to a person (manual → verified). */
export async function addIdentity(
  tenantId: string,
  personId: string,
  input: { sourceType: SourceMappingSourceType; identityType: IdentityType; identityValue: string },
): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("person_identities")
    .insert({
      tenant_id: tenantId,
      person_id: personId,
      source_type: input.sourceType,
      identity_type: input.identityType,
      identity_value: input.identityValue.trim(),
      confidence: 1,
      verified_by_user: true,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "identity_create_failed");
  return data.id as string;
}

/** Mark an identity as user-verified (confidence 1). */
export async function setIdentityVerified(identityId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("person_identities")
    .update({ verified_by_user: true, confidence: 1 })
    .eq("id", identityId);
  if (error) throw new Error(error.message);
}

/** Remove an identity mapping. */
export async function removeIdentity(identityId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("person_identities").delete().eq("id", identityId);
  if (error) throw new Error(error.message);
}

/** Add a tag to a person (idempotent via unique constraint). */
export async function addTag(tenantId: string, personId: string, tag: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("person_tags")
    .upsert(
      { tenant_id: tenantId, person_id: personId, tag: tag.trim() },
      { onConflict: "person_id,tag", ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);
}

/** Remove a tag from a person. */
export async function removeTag(personId: string, tag: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("person_tags")
    .delete()
    .eq("person_id", personId)
    .eq("tag", tag);
  if (error) throw new Error(error.message);
}
