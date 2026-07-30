"use server";

/**
 * People server actions. Each re-derives the trusted tenant context server-side
 * (never from client input) and writes through the RLS user client, so a tenant
 * can only ever mutate its own people. Governance: services/people-context-service.md.
 */

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { isPrivilegedRole, type TenantContext } from "@/modules/shared/tenant-context";
import { auditService } from "@/modules/audit";
import {
  createPerson,
  updatePerson,
  deletePerson,
  setPersonArchived,
  addIdentity,
  setIdentityVerified,
  removeIdentity,
  addTag,
  removeTag,
  applyTagBehaviour,
  setPersonCompany,
  setPersonSelf,
  generateLinkSuggestions,
  confirmSuggestion,
  rejectSuggestion,
  newPersonFromSuggestion,
  type CreatePersonInput,
  type UpdatePersonPatch,
} from "@/modules/people/people-server";
import {
  confirmEntityLink,
  rejectEntityLink,
  deleteEntityLink,
  updateEntityLink,
  upsertEntityLink,
  listSuggestedConnections,
  type SuggestedConnection,
  type SuggestedConnectionsQuery,
} from "@/modules/people/relationships";
import { generateCompanyLinkSuggestions } from "@/modules/companies/companies-server";
import type { EntityType, IdentityType, SourceMappingSourceType } from "@/modules/people/people.types";

type Result = { ok: boolean; error: string | null };

const VIEWER_READ_ONLY = "Viewers can browse but not make changes. Ask a workspace admin for a member role.";
const ADMIN_ONLY = "Only workspace owners and admins can permanently delete records. You can archive instead.";

/** Members and up can manage records; viewers are read-only. */
function canManage(ctx: TenantContext): boolean {
  return ctx.role !== "viewer";
}

export async function createPersonAction(
  input: CreatePersonInput,
): Promise<{ ok: boolean; id?: string; error: string | null }> {
  const ctx = await requireTenantContext();
  if (!canManage(ctx)) return { ok: false, error: VIEWER_READ_ONLY };
  if (!input?.displayName?.trim()) return { ok: false, error: "A name is required." };
  try {
    const id = await createPerson(ctx.tenantId, input);
    await auditService.record(ctx, { action: "person.created", target: id, metadata: { name: input.displayName } });
    revalidatePath("/people");
    return { ok: true, id, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Create failed." };
  }
}

export async function updatePersonAction(input: {
  personId: string;
  patch: UpdatePersonPatch;
}): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!canManage(ctx)) return { ok: false, error: VIEWER_READ_ONLY };
  if (!input?.personId) return { ok: false, error: "Missing person." };
  try {
    const changed = await updatePerson(input.personId, input.patch);
    if (changed) {
      await auditService.record(ctx, {
        action: "person.updated",
        target: input.personId,
        metadata: input.patch as Record<string, unknown>,
      });
    }
    revalidatePath("/people");
    return { ok: changed, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Update failed." };
  }
}

/**
 * Archive or restore a person. Archiving is the default "remove" in the UI —
 * reversible, keeps identities/tags/edges, and takes the record out of the
 * directory, suggestions, and the connections graph.
 */
export async function setPersonArchivedAction(input: {
  personId: string;
  archived: boolean;
}): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!canManage(ctx)) return { ok: false, error: VIEWER_READ_ONLY };
  if (!input?.personId) return { ok: false, error: "Missing person." };
  try {
    const changed = await setPersonArchived(input.personId, input.archived);
    if (!changed) return { ok: false, error: "Person not found." };
    await auditService.record(ctx, {
      action: input.archived ? "person.archived" : "person.unarchived",
      target: input.personId,
    });
    revalidatePath("/people");
    revalidatePath(`/people/${input.personId}`);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Archive failed." };
  }
}

/** Permanently delete a person (privileged roles only; archiving is the default). */
export async function deletePersonAction(input: { personId: string }): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!isPrivilegedRole(ctx.role)) return { ok: false, error: ADMIN_ONLY };
  if (!input?.personId) return { ok: false, error: "Missing person." };
  try {
    await deletePerson(input.personId);
    await auditService.record(ctx, { action: "person.deleted", target: input.personId });
    revalidatePath("/people");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Delete failed." };
  }
}

export async function addIdentityAction(input: {
  personId: string;
  sourceType: SourceMappingSourceType;
  identityType: IdentityType;
  identityValue: string;
}): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!canManage(ctx)) return { ok: false, error: VIEWER_READ_ONLY };
  if (!input?.personId || !input.identityValue?.trim()) {
    return { ok: false, error: "Missing identity value." };
  }
  try {
    const id = await addIdentity(ctx.tenantId, input.personId, {
      sourceType: input.sourceType,
      identityType: input.identityType,
      identityValue: input.identityValue,
    });
    await auditService.record(ctx, {
      action: "person.identity.added",
      target: input.personId,
      metadata: { identityId: id, identityType: input.identityType },
    });
    revalidatePath("/people");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Add identity failed." };
  }
}

export async function verifyIdentityAction(input: { identityId: string }): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!canManage(ctx)) return { ok: false, error: VIEWER_READ_ONLY };
  if (!input?.identityId) return { ok: false, error: "Missing identity." };
  try {
    await setIdentityVerified(input.identityId);
    await auditService.record(ctx, { action: "person.identity.verified", target: input.identityId });
    revalidatePath("/people");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Verify failed." };
  }
}

export async function removeIdentityAction(input: { identityId: string }): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!canManage(ctx)) return { ok: false, error: VIEWER_READ_ONLY };
  if (!input?.identityId) return { ok: false, error: "Missing identity." };
  try {
    await removeIdentity(input.identityId);
    await auditService.record(ctx, { action: "person.identity.removed", target: input.identityId });
    revalidatePath("/people");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Remove failed." };
  }
}

export async function addTagAction(
  input: { personId: string; tag: string },
): Promise<{ ok: boolean; effects?: string[]; error: string | null }> {
  const ctx = await requireTenantContext();
  if (!canManage(ctx)) return { ok: false, error: VIEWER_READ_ONLY };
  if (!input?.personId || !input.tag?.trim()) return { ok: false, error: "Missing tag." };
  try {
    const tag = input.tag.trim();
    await addTag(ctx.tenantId, input.personId, tag);
    // Apply the tag's behavioural contract as explicit, inspectable state.
    const effects = await applyTagBehaviour(
      { tenantId: ctx.tenantId, userId: ctx.userId },
      input.personId,
      tag,
    );
    await auditService.record(ctx, {
      action: "person.tag.added",
      target: input.personId,
      metadata: { tag, effects },
    });
    revalidatePath("/people");
    revalidatePath(`/people/${input.personId}`);
    return { ok: true, effects, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Add tag failed." };
  }
}

/** Set or clear a person's resolved company (records a confirmed works_at edge). */
export async function setPersonCompanyAction(input: {
  personId: string;
  companyId: string | null;
}): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!canManage(ctx)) return { ok: false, error: VIEWER_READ_ONLY };
  if (!input?.personId) return { ok: false, error: "Missing person." };
  try {
    await setPersonCompany(ctx.tenantId, input.personId, input.companyId);
    await auditService.record(ctx, {
      action: "person.company.set",
      target: input.personId,
      metadata: { companyId: input.companyId },
    });
    revalidatePath("/people");
    revalidatePath(`/people/${input.personId}`);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Set company failed." };
  }
}

/** Mark or unmark a person as the operator themselves ("This is me"). */
export async function setPersonSelfAction(input: {
  personId: string;
  isSelf: boolean;
}): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!canManage(ctx)) return { ok: false, error: VIEWER_READ_ONLY };
  if (!input?.personId) return { ok: false, error: "Missing person." };
  try {
    await setPersonSelf(ctx.tenantId, input.personId, input.isSelf);
    await auditService.record(ctx, {
      action: "person.self.set",
      target: input.personId,
      metadata: { isSelf: input.isSelf },
    });
    revalidatePath("/people");
    revalidatePath(`/people/${input.personId}`);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Update failed." };
  }
}

/** Confirm a system-suggested relationship edge. */
export async function confirmLinkAction(input: { linkId: string }): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!canManage(ctx)) return { ok: false, error: VIEWER_READ_ONLY };
  if (!input?.linkId) return { ok: false, error: "Missing link." };
  try {
    await confirmEntityLink(input.linkId);
    await auditService.record(ctx, { action: "relationship.confirmed", target: input.linkId });
    revalidatePath("/people");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Confirm failed." };
  }
}

/** Reject a suggested relationship edge. */
export async function rejectLinkAction(input: { linkId: string }): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!canManage(ctx)) return { ok: false, error: VIEWER_READ_ONLY };
  if (!input?.linkId) return { ok: false, error: "Missing link." };
  try {
    await rejectEntityLink(input.linkId);
    await auditService.record(ctx, { action: "relationship.rejected", target: input.linkId });
    revalidatePath("/people");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Reject failed." };
  }
}

/** Manually create a confirmed relationship edge between two entities. */
export async function createLinkAction(input: {
  sourceType: EntityType;
  sourceId: string;
  targetType: EntityType;
  targetId: string;
  relationshipType: string;
}): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!canManage(ctx)) return { ok: false, error: VIEWER_READ_ONLY };
  if (!input?.sourceId || !input?.targetId || !input?.relationshipType) {
    return { ok: false, error: "Missing link details." };
  }
  if (input.sourceType === input.targetType && input.sourceId === input.targetId) {
    return { ok: false, error: "A record cannot be linked to itself." };
  }
  try {
    await upsertEntityLink(ctx.tenantId, {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      targetType: input.targetType,
      targetId: input.targetId,
      relationshipType: input.relationshipType,
      confidence: 1,
      origin: "user",
      status: "confirmed",
      evidenceSummary: "Added by you.",
    });
    await auditService.record(ctx, {
      action: "relationship.created",
      target: input.sourceId,
      metadata: { relationshipType: input.relationshipType, targetId: input.targetId },
    });
    revalidatePath("/people");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Create link failed." };
  }
}

/** Edit an existing relationship edge's kind (marks it user-confirmed). */
export async function updateLinkAction(input: {
  linkId: string;
  relationshipType: string;
}): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!canManage(ctx)) return { ok: false, error: VIEWER_READ_ONLY };
  if (!input?.linkId || !input.relationshipType?.trim()) {
    return { ok: false, error: "Missing link details." };
  }
  try {
    const changed = await updateEntityLink(input.linkId, {
      relationshipType: input.relationshipType.trim(),
    });
    if (!changed) return { ok: false, error: "Link not found." };
    await auditService.record(ctx, {
      action: "relationship.updated",
      target: input.linkId,
      metadata: { relationshipType: input.relationshipType },
    });
    revalidatePath("/people");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Update link failed." };
  }
}

/** Remove a relationship edge outright. */
export async function deleteLinkAction(input: { linkId: string }): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!canManage(ctx)) return { ok: false, error: VIEWER_READ_ONLY };
  if (!input?.linkId) return { ok: false, error: "Missing link." };
  try {
    await deleteEntityLink(input.linkId);
    await auditService.record(ctx, { action: "relationship.removed", target: input.linkId });
    revalidatePath("/people");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Remove link failed." };
  }
}

/**
 * Search/browse suggested connections for the Suggestions tab's "View more"
 * explorer. Read-only, so viewers may call it too.
 */
export async function searchSuggestedConnectionsAction(
  query: SuggestedConnectionsQuery,
): Promise<{ ok: boolean; items: SuggestedConnection[]; total: number; error: string | null }> {
  await requireTenantContext();
  try {
    const page = await listSuggestedConnections({
      ...query,
      limit: Math.min(query.limit ?? 20, 50),
    });
    return { ok: true, items: page.items, total: page.total, error: null };
  } catch (err) {
    return {
      ok: false,
      items: [],
      total: 0,
      error: err instanceof Error ? err.message : "Search failed.",
    };
  }
}

export async function removeTagAction(input: { personId: string; tag: string }): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!canManage(ctx)) return { ok: false, error: VIEWER_READ_ONLY };
  if (!input?.personId || !input.tag) return { ok: false, error: "Missing tag." };
  try {
    await removeTag(input.personId, input.tag);
    revalidatePath("/people");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Remove tag failed." };
  }
}

// --- Information Correlation -------------------------------------------------

/**
 * Run correlation over recent items: persist new confirmable identity
 * suggestions ("same person?") and propose person↔company links from matching
 * email domains. Confident, verified matches attach as signals automatically;
 * everything uncertain lands in the correlation inbox for you to confirm.
 */
export async function runCorrelationAction(): Promise<{
  ok: boolean;
  added?: number;
  companyLinks?: number;
  error: string | null;
}> {
  const ctx = await requireTenantContext();
  if (!canManage(ctx)) return { ok: false, error: VIEWER_READ_ONLY };
  try {
    const [added, companyLinks] = await Promise.all([
      generateLinkSuggestions(ctx.tenantId),
      generateCompanyLinkSuggestions(ctx.tenantId),
    ]);
    await auditService.record(ctx, {
      action: "correlation.run",
      metadata: { suggestionsAdded: added, companyLinks },
    });
    revalidatePath("/people");
    return { ok: true, added, companyLinks, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Correlation failed." };
  }
}

/** Confirm a "same person?" suggestion → verified identity + feedback. */
export async function confirmSuggestionAction(input: { suggestionId: string }): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!canManage(ctx)) return { ok: false, error: VIEWER_READ_ONLY };
  if (!input?.suggestionId) return { ok: false, error: "Missing suggestion." };
  try {
    const ok = await confirmSuggestion(ctx.tenantId, input.suggestionId);
    if (ok) await auditService.record(ctx, { action: "correlation.suggestion.confirmed", target: input.suggestionId });
    revalidatePath("/people");
    return { ok, error: ok ? null : "Nothing to confirm (no candidate person)." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Confirm failed." };
  }
}

/** Reject a suggestion (not a match) → feedback. */
export async function rejectSuggestionAction(input: { suggestionId: string }): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!canManage(ctx)) return { ok: false, error: VIEWER_READ_ONLY };
  if (!input?.suggestionId) return { ok: false, error: "Missing suggestion." };
  try {
    await rejectSuggestion(ctx.tenantId, input.suggestionId);
    await auditService.record(ctx, { action: "correlation.suggestion.rejected", target: input.suggestionId });
    revalidatePath("/people");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Reject failed." };
  }
}

/** Create a new person from a suggestion → verified identity + feedback. */
export async function newPersonFromSuggestionAction(input: { suggestionId: string }): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!canManage(ctx)) return { ok: false, error: VIEWER_READ_ONLY };
  if (!input?.suggestionId) return { ok: false, error: "Missing suggestion." };
  try {
    const id = await newPersonFromSuggestion(ctx.tenantId, input.suggestionId);
    if (id) await auditService.record(ctx, { action: "correlation.suggestion.new_person", target: id });
    revalidatePath("/people");
    return { ok: Boolean(id), error: id ? null : "Could not create person." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed." };
  }
}
