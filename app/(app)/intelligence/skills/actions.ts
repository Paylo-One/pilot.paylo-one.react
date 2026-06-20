"use server";

/**
 * Server Actions for Custom Skills (/intelligence/skills).
 *
 * Tenant context is re-derived server-side; every mutation is gated to owners
 * and admins (skills are system instructions that shape AI behaviour), routed
 * through the custom-skills server module (secret client, append-only +
 * single-active invariants), and audited.
 */

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { isPrivilegedRole } from "@/modules/shared";
import { auditService } from "@/modules/audit";
import {
  activateSkillVersion,
  createSkill,
  createSkillVersion,
  getSkill,
  getSkillVersion,
  setPromptSkillLink,
  setSkillArchived,
  updateSkillMeta,
} from "@/modules/custom-skills/server";
import type { SkillBehaviour } from "@/modules/custom-skills";

interface ActionResponse {
  readonly ok: boolean;
  readonly error: string | null;
}

function failure(error: string): ActionResponse {
  return { ok: false, error };
}

const ADMIN_ONLY = "Only workspace owners and admins can change skills.";

function revalidateSkills(skillId?: string): void {
  revalidatePath("/intelligence/skills");
  revalidatePath("/intelligence");
  if (skillId) revalidatePath(`/intelligence/skills/${skillId}`);
}

export async function createSkillAction(input: {
  name: string;
  purpose: string;
  behaviour: SkillBehaviour;
}): Promise<ActionResponse & { skillId?: string }> {
  const ctx = await requireTenantContext();
  if (!isPrivilegedRole(ctx.role)) return failure(ADMIN_ONLY);
  if (!input?.name?.trim()) return failure("Give the skill a name.");
  if (!input.behaviour?.instructions?.trim()) {
    return failure("A skill needs behavioural instructions.");
  }

  const result = await createSkill(ctx, {
    name: input.name.trim(),
    purpose: input.purpose?.trim() ?? "",
    behaviour: input.behaviour,
  });
  if (!result.ok) return failure(result.error.message);

  await auditService.record(ctx, {
    action: "custom_skill.created",
    target: result.value.skillId,
    metadata: { name: input.name },
  });
  revalidateSkills(result.value.skillId);
  return { ok: true, error: null, skillId: result.value.skillId };
}

export async function createSkillVersionAction(input: {
  customSkillId: string;
  behaviour: SkillBehaviour;
  changeNote?: string;
}): Promise<ActionResponse & { versionId?: string; versionNumber?: number }> {
  const ctx = await requireTenantContext();
  if (!isPrivilegedRole(ctx.role)) return failure(ADMIN_ONLY);
  if (!input?.customSkillId) return failure("Missing skill id.");
  if (!input.behaviour?.instructions?.trim()) {
    return failure("A skill needs behavioural instructions.");
  }

  const result = await createSkillVersion(ctx, {
    customSkillId: input.customSkillId,
    behaviour: input.behaviour,
    changeNote: input.changeNote?.trim() || undefined,
  });
  if (!result.ok) return failure(result.error.message);

  await auditService.record(ctx, {
    action: "custom_skill.version.created",
    target: input.customSkillId,
    metadata: {
      versionId: result.value.versionId,
      versionNumber: result.value.versionNumber,
    },
  });
  revalidateSkills(input.customSkillId);
  return { ok: true, error: null, ...result.value };
}

export async function activateSkillVersionAction(input: {
  versionId: string;
}): Promise<ActionResponse> {
  const ctx = await requireTenantContext();
  if (!isPrivilegedRole(ctx.role)) return failure(ADMIN_ONLY);
  if (!input?.versionId) return failure("Missing version id.");

  const version = await getSkillVersion(ctx, input.versionId);
  if (!version.ok) return failure(version.error.message);

  const result = await activateSkillVersion(ctx, input.versionId);
  if (!result.ok) return failure(result.error.message);

  await auditService.record(ctx, {
    action: "custom_skill.version.activated",
    target: version.value.customSkillId,
    metadata: {
      versionId: input.versionId,
      versionNumber: version.value.versionNumber,
    },
  });
  revalidateSkills(version.value.customSkillId);
  return { ok: true, error: null };
}

/** Restore = append a new draft copying the selected version. */
export async function restoreSkillVersionAction(input: {
  versionId: string;
}): Promise<ActionResponse> {
  const ctx = await requireTenantContext();
  if (!isPrivilegedRole(ctx.role)) return failure(ADMIN_ONLY);
  if (!input?.versionId) return failure("Missing version id.");

  const version = await getSkillVersion(ctx, input.versionId);
  if (!version.ok) return failure(version.error.message);
  const v = version.value;

  const result = await createSkillVersion(ctx, {
    customSkillId: v.customSkillId,
    behaviour: {
      instructions: v.instructions,
      whenToUse: v.whenToUse,
      whenNotToUse: v.whenNotToUse,
      outputFormat: v.outputFormat,
      toneGuidance: v.toneGuidance,
      requiredContext: v.requiredContext,
      safetyConstraints: v.safetyConstraints,
    },
    changeNote: `Restored from version ${v.versionNumber}.`,
    restoredFromVersionId: v.id,
  });
  if (!result.ok) return failure(result.error.message);

  await auditService.record(ctx, {
    action: "custom_skill.version.restored",
    target: v.customSkillId,
    metadata: {
      versionId: result.value.versionId,
      versionNumber: result.value.versionNumber,
      restoredFromVersionNumber: v.versionNumber,
    },
  });
  revalidateSkills(v.customSkillId);
  return { ok: true, error: null };
}

export async function updateSkillMetaAction(input: {
  skillId: string;
  name?: string;
  purpose?: string;
}): Promise<ActionResponse> {
  const ctx = await requireTenantContext();
  if (!isPrivilegedRole(ctx.role)) return failure(ADMIN_ONLY);
  if (!input?.skillId) return failure("Missing skill id.");
  if (input.name !== undefined && !input.name.trim())
    return failure("Name cannot be empty.");

  const result = await updateSkillMeta(ctx, input.skillId, {
    name: input.name?.trim(),
    purpose: input.purpose?.trim(),
  });
  if (!result.ok) return failure(result.error.message);

  await auditService.record(ctx, {
    action: "custom_skill.updated",
    target: input.skillId,
    metadata: { name: input.name ?? null },
  });
  revalidateSkills(input.skillId);
  return { ok: true, error: null };
}

export async function setSkillArchivedAction(input: {
  skillId: string;
  archived: boolean;
}): Promise<ActionResponse> {
  const ctx = await requireTenantContext();
  if (!isPrivilegedRole(ctx.role)) return failure(ADMIN_ONLY);
  if (!input?.skillId) return failure("Missing skill id.");

  const result = await setSkillArchived(ctx, input.skillId, input.archived);
  if (!result.ok) return failure(result.error.message);

  await auditService.record(ctx, {
    action: input.archived
      ? "custom_skill.archived"
      : "custom_skill.unarchived",
    target: input.skillId,
    metadata: {},
  });
  revalidateSkills(input.skillId);
  return { ok: true, error: null };
}

/** Attach / detach a skill from a prompt. */
export async function setPromptSkillLinkAction(input: {
  tenantPromptId: string;
  customSkillId: string;
  linked: boolean;
}): Promise<ActionResponse> {
  const ctx = await requireTenantContext();
  if (!isPrivilegedRole(ctx.role)) return failure(ADMIN_ONLY);
  if (!input?.tenantPromptId || !input?.customSkillId)
    return failure("Missing ids.");

  // Confirm the skill belongs to the tenant before linking.
  const skill = await getSkill(ctx, input.customSkillId);
  if (!skill.ok) return failure(skill.error.message);

  const result = await setPromptSkillLink(
    ctx,
    input.tenantPromptId,
    input.customSkillId,
    input.linked,
  );
  if (!result.ok) return failure(result.error.message);

  await auditService.record(ctx, {
    action: input.linked ? "prompt.skill.linked" : "prompt.skill.unlinked",
    target: input.tenantPromptId,
    metadata: { customSkillId: input.customSkillId },
  });
  revalidatePath(`/intelligence/prompts/${input.tenantPromptId}`);
  revalidateSkills(input.customSkillId);
  return { ok: true, error: null };
}
