import "server-only";

/**
 * modules/custom-skills/server.ts
 *
 * DB-backed data layer for Custom Skills. Mirrors prompt-versioning/server.ts:
 * reads use the RLS-scoped USER client; mutations use the SECRET client with
 * explicit tenant predicates; append-only + single-active invariants live in
 * SQL (one-active partial index + activate_custom_skill_version RPC).
 *
 * `getLinkedSkillsForPrompt` is the read used during prompt resolution (SECRET
 * client, never throws) so a prompt's linked skills compose into its system
 * instruction.
 */

import {
  ValidationError,
  err,
  ok,
  type Result,
  type TenantContext,
} from "@/modules/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import {
  DEFAULT_SKILL_CATALOGUE,
  type CustomSkillDetail,
  type CustomSkillSummary,
  type CustomSkillVersion,
  type SkillBehaviour,
  type SkillOrigin,
  type SkillVersionStatus,
} from "./index";

const SKILL_SELECT =
  "id, skill_key, name, purpose, origin, catalogue_version, archived_at, created_by, created_at, updated_at";
const VERSION_SELECT =
  "id, custom_skill_id, version_number, instructions, when_to_use, when_not_to_use, output_format, tone_guidance, required_context, safety_constraints, status, change_note, restored_from_version_id, created_by, created_at, activated_at, archived_at";

interface SkillRow {
  id: string;
  skill_key: string;
  name: string;
  purpose: string;
  origin: string;
  catalogue_version: string;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  id: string;
  custom_skill_id: string;
  version_number: number;
  instructions: string;
  when_to_use: string;
  when_not_to_use: string;
  output_format: string;
  tone_guidance: string;
  required_context: string;
  safety_constraints: string;
  status: string;
  change_note: string | null;
  restored_from_version_id: string | null;
  created_by: string | null;
  created_at: string;
  activated_at: string | null;
  archived_at: string | null;
}

function mapSkillRow(
  row: SkillRow,
): Omit<
  CustomSkillSummary,
  "activeVersionNumber" | "versionCount" | "linkedPromptCount"
> {
  return {
    id: row.id,
    skillKey: row.skill_key,
    name: row.name,
    purpose: row.purpose,
    origin: row.origin as SkillOrigin,
    catalogueVersion: row.catalogue_version,
    archivedAt: row.archived_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVersionRow(row: VersionRow): CustomSkillVersion {
  return {
    id: row.id,
    customSkillId: row.custom_skill_id,
    versionNumber: row.version_number,
    instructions: row.instructions,
    whenToUse: row.when_to_use,
    whenNotToUse: row.when_not_to_use,
    outputFormat: row.output_format,
    toneGuidance: row.tone_guidance,
    requiredContext: row.required_context,
    safetyConstraints: row.safety_constraints,
    status: row.status as SkillVersionStatus,
    changeNote: row.change_note,
    restoredFromVersionId: row.restored_from_version_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    archivedAt: row.archived_at,
  };
}

/** Copy the default skill catalogue into a tenant's library. Idempotent. */
export async function seedTenantSkills(
  tenantId: string,
  userId?: string,
): Promise<void> {
  const secret = createSupabaseSecretClient();
  const { data: inserted, error } = await secret
    .from("custom_skills")
    .upsert(
      DEFAULT_SKILL_CATALOGUE.map((s) => ({
        tenant_id: tenantId,
        skill_key: s.skillKey,
        name: s.name,
        purpose: s.purpose,
        origin: "system_default",
        catalogue_version: s.catalogueVersion,
        created_by: userId ?? null,
      })),
      { onConflict: "tenant_id,skill_key", ignoreDuplicates: true },
    )
    .select("id, skill_key");
  if (error) throw new Error(error.message);
  if (!inserted || inserted.length === 0) return;

  const { error: versionError } = await secret
    .from("custom_skill_versions")
    .insert(
      inserted.map((row) => {
        const d = DEFAULT_SKILL_CATALOGUE.find(
          (s) => s.skillKey === row.skill_key,
        )!;
        return {
          tenant_id: tenantId,
          custom_skill_id: row.id,
          version_number: 1,
          instructions: d.instructions,
          when_to_use: d.whenToUse,
          when_not_to_use: d.whenNotToUse,
          output_format: d.outputFormat,
          tone_guidance: d.toneGuidance,
          required_context: d.requiredContext,
          safety_constraints: d.safetyConstraints,
          status: "active",
          change_note: "Seeded from the default catalogue.",
          created_by: userId ?? null,
          activated_at: new Date().toISOString(),
          activated_by: userId ?? null,
        };
      }),
    );
  if (versionError) throw new Error(versionError.message);
}

/** List the tenant's skills, lazily seeding the default catalogue on first read. */
export async function listSkills(
  ctx: TenantContext,
): Promise<Result<CustomSkillSummary[]>> {
  const supabase = await createSupabaseServerClient();

  let { data, error } = await supabase
    .from("custom_skills")
    .select(SKILL_SELECT)
    .order("name", { ascending: true });
  if (error) return err(new ValidationError(error.message));

  if (!data || data.length === 0) {
    await seedTenantSkills(ctx.tenantId, ctx.userId);
    ({ data, error } = await supabase
      .from("custom_skills")
      .select(SKILL_SELECT)
      .order("name", { ascending: true }));
    if (error) return err(new ValidationError(error.message));
  }

  const { data: versions, error: versionsError } = await supabase
    .from("custom_skill_versions")
    .select("custom_skill_id, version_number, status");
  if (versionsError) return err(new ValidationError(versionsError.message));

  const { data: links, error: linksError } = await supabase
    .from("prompt_skill_links")
    .select("custom_skill_id");
  if (linksError) return err(new ValidationError(linksError.message));

  const summaries = ((data ?? []) as SkillRow[]).map((row) => {
    const own = (versions ?? []).filter((v) => v.custom_skill_id === row.id);
    const active = own.find((v) => v.status === "active");
    const linkedPromptCount = (links ?? []).filter(
      (l) => l.custom_skill_id === row.id,
    ).length;
    return {
      ...mapSkillRow(row),
      activeVersionNumber: active ? (active.version_number as number) : null,
      versionCount: own.length,
      linkedPromptCount,
    };
  });
  return ok(summaries);
}

/** One skill with its full version history (newest first) + linked prompt ids. */
export async function getSkill(
  ctx: TenantContext,
  id: string,
): Promise<Result<CustomSkillDetail>> {
  const supabase = await createSupabaseServerClient();

  const { data: skill, error } = await supabase
    .from("custom_skills")
    .select(SKILL_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) return err(new ValidationError(error.message));
  if (!skill) return err(new ValidationError("skill not found"));

  const { data: versions, error: versionsError } = await supabase
    .from("custom_skill_versions")
    .select(VERSION_SELECT)
    .eq("custom_skill_id", id)
    .order("version_number", { ascending: false });
  if (versionsError) return err(new ValidationError(versionsError.message));

  const { data: links, error: linksError } = await supabase
    .from("prompt_skill_links")
    .select("tenant_prompt_id")
    .eq("custom_skill_id", id);
  if (linksError) return err(new ValidationError(linksError.message));

  return ok({
    ...mapSkillRow(skill as SkillRow),
    activeVersionNumber:
      ((versions ?? []) as VersionRow[]).find((v) => v.status === "active")
        ?.version_number ?? null,
    versionCount: (versions ?? []).length,
    linkedPromptCount: (links ?? []).length,
    versions: ((versions ?? []) as VersionRow[]).map(mapVersionRow),
    linkedPromptIds: (links ?? []).map((l) => l.tenant_prompt_id as string),
  } as CustomSkillDetail);
}

/** One stored version (tenant-scoped via RLS). */
export async function getSkillVersion(
  ctx: TenantContext,
  versionId: string,
): Promise<Result<CustomSkillVersion>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("custom_skill_versions")
    .select(VERSION_SELECT)
    .eq("id", versionId)
    .maybeSingle();
  if (error) return err(new ValidationError(error.message));
  if (!data) return err(new ValidationError("skill version not found"));
  return ok(mapVersionRow(data as VersionRow));
}

async function assertSkillOwned(
  tenantId: string,
  skillId: string,
): Promise<Result<void>> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("custom_skills")
    .select("id")
    .eq("id", skillId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) return err(new ValidationError(error.message));
  if (!data) return err(new ValidationError("skill not found for tenant"));
  return ok(undefined);
}

export interface CreateSkillInput {
  readonly name: string;
  readonly purpose: string;
  readonly behaviour: SkillBehaviour;
  readonly changeNote?: string;
}

/** Create a brand-new custom skill + its active version 1. */
export async function createSkill(
  ctx: TenantContext,
  input: CreateSkillInput,
): Promise<Result<{ skillId: string }>> {
  const secret = createSupabaseSecretClient();
  const skillKey = `custom_${crypto.randomUUID().slice(0, 8)}`;

  const { data: skill, error } = await secret
    .from("custom_skills")
    .insert({
      tenant_id: ctx.tenantId,
      skill_key: skillKey,
      name: input.name,
      purpose: input.purpose,
      origin: "custom",
      catalogue_version: "1.0.0",
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !skill)
    return err(new ValidationError(error?.message ?? "skill_create_failed"));

  const { error: versionError } = await secret
    .from("custom_skill_versions")
    .insert({
      tenant_id: ctx.tenantId,
      custom_skill_id: skill.id,
      version_number: 1,
      instructions: input.behaviour.instructions,
      when_to_use: input.behaviour.whenToUse,
      when_not_to_use: input.behaviour.whenNotToUse,
      output_format: input.behaviour.outputFormat,
      tone_guidance: input.behaviour.toneGuidance,
      required_context: input.behaviour.requiredContext,
      safety_constraints: input.behaviour.safetyConstraints,
      status: "active",
      change_note: input.changeNote ?? "Created.",
      created_by: ctx.userId,
      activated_at: new Date().toISOString(),
      activated_by: ctx.userId,
    });
  if (versionError) return err(new ValidationError(versionError.message));
  return ok({ skillId: skill.id as string });
}

export interface CreateSkillVersionInput {
  readonly customSkillId: string;
  readonly behaviour: SkillBehaviour;
  readonly changeNote?: string;
  readonly restoredFromVersionId?: string;
}

/** Append a new draft version (`version_number = max + 1`). Never overwrites. */
export async function createSkillVersion(
  ctx: TenantContext,
  input: CreateSkillVersionInput,
): Promise<Result<{ versionId: string; versionNumber: number }>> {
  const owned = await assertSkillOwned(ctx.tenantId, input.customSkillId);
  if (!owned.ok) return owned;

  const secret = createSupabaseSecretClient();
  const { data: latest, error: maxError } = await secret
    .from("custom_skill_versions")
    .select("version_number")
    .eq("custom_skill_id", input.customSkillId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxError) return err(new ValidationError(maxError.message));
  const versionNumber =
    ((latest?.version_number as number | undefined) ?? 0) + 1;

  const { data, error } = await secret
    .from("custom_skill_versions")
    .insert({
      tenant_id: ctx.tenantId,
      custom_skill_id: input.customSkillId,
      version_number: versionNumber,
      instructions: input.behaviour.instructions,
      when_to_use: input.behaviour.whenToUse,
      when_not_to_use: input.behaviour.whenNotToUse,
      output_format: input.behaviour.outputFormat,
      tone_guidance: input.behaviour.toneGuidance,
      required_context: input.behaviour.requiredContext,
      safety_constraints: input.behaviour.safetyConstraints,
      status: "draft",
      change_note: input.changeNote ?? null,
      restored_from_version_id: input.restoredFromVersionId ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data)
    return err(new ValidationError(error?.message ?? "version_create_failed"));
  return ok({ versionId: data.id as string, versionNumber });
}

/** Atomically activate a version (archives the previously active one). */
export async function activateSkillVersion(
  ctx: TenantContext,
  versionId: string,
): Promise<Result<void>> {
  const secret = createSupabaseSecretClient();
  const { error } = await secret.rpc("activate_custom_skill_version", {
    p_tenant_id: ctx.tenantId,
    p_version_id: versionId,
    p_user_id: ctx.userId,
  });
  if (error) return err(new ValidationError(error.message));
  return ok(undefined);
}

/** Update skill metadata (name / purpose only — behaviour lives in versions). */
export async function updateSkillMeta(
  ctx: TenantContext,
  id: string,
  input: { name?: string; purpose?: string },
): Promise<Result<void>> {
  const patch: Record<string, string> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.purpose !== undefined) patch.purpose = input.purpose;
  if (Object.keys(patch).length === 0) return ok(undefined);

  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("custom_skills")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .select("id");
  if (error) return err(new ValidationError(error.message));
  if (!data || data.length === 0)
    return err(new ValidationError("skill not found"));
  return ok(undefined);
}

/** Archive / unarchive a whole skill. */
export async function setSkillArchived(
  ctx: TenantContext,
  id: string,
  archived: boolean,
): Promise<Result<void>> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("custom_skills")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .select("id");
  if (error) return err(new ValidationError(error.message));
  if (!data || data.length === 0)
    return err(new ValidationError("skill not found"));
  return ok(undefined);
}

/** Attach / detach a skill to a prompt. */
export async function setPromptSkillLink(
  ctx: TenantContext,
  tenantPromptId: string,
  customSkillId: string,
  linked: boolean,
): Promise<Result<void>> {
  const secret = createSupabaseSecretClient();
  if (linked) {
    const { error } = await secret.from("prompt_skill_links").upsert(
      {
        tenant_id: ctx.tenantId,
        tenant_prompt_id: tenantPromptId,
        custom_skill_id: customSkillId,
        created_by: ctx.userId,
      },
      {
        onConflict: "tenant_prompt_id,custom_skill_id",
        ignoreDuplicates: true,
      },
    );
    if (error) return err(new ValidationError(error.message));
  } else {
    const { error } = await secret
      .from("prompt_skill_links")
      .delete()
      .eq("tenant_id", ctx.tenantId)
      .eq("tenant_prompt_id", tenantPromptId)
      .eq("custom_skill_id", customSkillId);
    if (error) return err(new ValidationError(error.message));
  }
  return ok(undefined);
}

/**
 * The active-version behaviour of every skill linked to a prompt, for system-
 * prompt composition. SECRET client (runs inside the Gateway), never throws —
 * returns [] on any failure so inference is never blocked.
 */
export async function getLinkedSkillsForPrompt(
  tenantId: string,
  tenantPromptId: string,
): Promise<Array<{ name: string; instructions: string }>> {
  try {
    const secret = createSupabaseSecretClient();
    const { data: links } = await secret
      .from("prompt_skill_links")
      .select("custom_skill_id, position")
      .eq("tenant_id", tenantId)
      .eq("tenant_prompt_id", tenantPromptId)
      .order("position", { ascending: true });
    if (!links || links.length === 0) return [];

    const skillIds = links.map((l) => l.custom_skill_id as string);
    const { data: versions } = await secret
      .from("custom_skill_versions")
      .select(
        "custom_skill_id, instructions, custom_skills!inner(name, archived_at)",
      )
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .in("custom_skill_id", skillIds);
    if (!versions) return [];

    // Preserve link order; skip archived skills.
    return skillIds
      .map((id) => versions.find((v) => v.custom_skill_id === id))
      .filter((v): v is NonNullable<typeof v> => {
        if (!v) return false;
        const skill = v.custom_skills as unknown as {
          archived_at: string | null;
        };
        return !skill?.archived_at;
      })
      .map((v) => ({
        name: (v.custom_skills as unknown as { name: string }).name,
        instructions: v.instructions as string,
      }));
  } catch (cause) {
    console.warn(
      "[custom-skills] linked-skill resolution failed; omitting from system prompt:",
      cause instanceof Error ? cause.message : cause,
    );
    return [];
  }
}
