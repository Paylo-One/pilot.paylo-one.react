"use server";

/**
 * People server actions. Each re-derives the trusted tenant context server-side
 * (never from client input) and writes through the RLS user client, so a tenant
 * can only ever mutate its own people. Governance: services/people-context-service.md.
 */

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { auditService } from "@/modules/audit";
import {
  createPerson,
  updatePerson,
  deletePerson,
  addIdentity,
  setIdentityVerified,
  removeIdentity,
  addTag,
  removeTag,
  generateLinkSuggestions,
  confirmSuggestion,
  rejectSuggestion,
  newPersonFromSuggestion,
  type CreatePersonInput,
  type UpdatePersonPatch,
} from "@/modules/people/people-server";
import type { IdentityType, SourceMappingSourceType } from "@/modules/people/people.types";

type Result = { ok: boolean; error: string | null };

export async function createPersonAction(
  input: CreatePersonInput,
): Promise<{ ok: boolean; id?: string; error: string | null }> {
  const ctx = await requireTenantContext();
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

export async function deletePersonAction(input: { personId: string }): Promise<Result> {
  const ctx = await requireTenantContext();
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

export async function addTagAction(input: { personId: string; tag: string }): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!input?.personId || !input.tag?.trim()) return { ok: false, error: "Missing tag." };
  try {
    await addTag(ctx.tenantId, input.personId, input.tag);
    revalidatePath("/people");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Add tag failed." };
  }
}

export async function removeTagAction(input: { personId: string; tag: string }): Promise<Result> {
  await requireTenantContext();
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

/** Run correlation over recent items; persist new confirmable suggestions. */
export async function runCorrelationAction(): Promise<{ ok: boolean; added?: number; error: string | null }> {
  const ctx = await requireTenantContext();
  try {
    const added = await generateLinkSuggestions(ctx.tenantId);
    await auditService.record(ctx, { action: "correlation.run", metadata: { suggestionsAdded: added } });
    revalidatePath("/people");
    return { ok: true, added, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Correlation failed." };
  }
}

/** Confirm a "same person?" suggestion → verified identity + feedback. */
export async function confirmSuggestionAction(input: { suggestionId: string }): Promise<Result> {
  const ctx = await requireTenantContext();
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
