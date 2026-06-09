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
import type {
  IdentityType,
  Person,
  PersonIdentity,
  PersonImportanceLevel,
  PersonStatus,
  RelationshipType,
  SourceMappingSourceType,
} from "./people.types";

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

/** List the tenant's people with their identities + tags (RLS-scoped). */
export async function listPeople(): Promise<Person[]> {
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
