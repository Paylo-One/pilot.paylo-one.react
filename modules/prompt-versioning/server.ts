import "server-only";

/**
 * modules/prompt-versioning/server.ts
 *
 * DB-backed prompt resolution + the tenant prompt library data layer.
 *
 * Resolution order (the Gateway calls `promptVersioningService.resolve`):
 *  1. explicit `promptVersionId` pin (test runs) — that exact row, any status;
 *  2. the tenant's ACTIVE version for the template key;
 *  3. the in-code default catalogue (`fallbackResolve`) — the terminal branch,
 *     so inference never breaks for un-seeded tenants or on DB failure.
 *
 * Client choice: reads use the RLS-scoped USER client; all mutations use the
 * SECRET client with explicit tenant predicates — the append-only and
 * single-active invariants are enforced here + in SQL, never client-side.
 * Resolution uses the SECRET client (explicit tenant filter) because it runs
 * inside the Gateway, matching the metering write's pattern.
 */

import { ValidationError, err, ok, type Result, type TenantContext } from "@/modules/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import {
  fallbackResolve,
  type PromptInputVariable,
  type PromptModelSettings,
  type PromptOutputFormat,
  type PromptTemplateKey,
  type PromptVersioningService,
  type ResolvedPrompt,
  type StoredPromptVersion,
  type StoredTestRun,
  type StoredVersionStatus,
  type TenantPromptDetail,
  type TenantPromptSummary,
} from "./index";
import { DEFAULT_PROMPT_CATALOGUE } from "./defaults";

// --- Row mapping --------------------------------------------------------------

const PROMPT_SELECT =
  "id, template_key, name, description, workflow, catalogue_version, archived_at, created_by, created_at, updated_at";

const VERSION_SELECT =
  "id, tenant_prompt_id, version_number, content, input_variables, output_format, model_settings, status, change_note, restored_from_version_id, created_by, created_at, activated_at, archived_at";

const TEST_RUN_SELECT =
  "id, tenant_prompt_id, prompt_version_id, input_kind, input_payload, model_id, model_settings, status, output, validation, error, latency_ms, total_tokens, created_at";

interface PromptRow {
  id: string;
  template_key: string;
  name: string;
  description: string | null;
  workflow: string;
  catalogue_version: string;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  id: string;
  tenant_prompt_id: string;
  version_number: number;
  content: string;
  input_variables: unknown;
  output_format: unknown;
  model_settings: unknown;
  status: string;
  change_note: string | null;
  restored_from_version_id: string | null;
  created_by: string | null;
  created_at: string;
  activated_at: string | null;
  archived_at: string | null;
}

interface TestRunRow {
  id: string;
  tenant_prompt_id: string;
  prompt_version_id: string;
  input_kind: string;
  input_payload: unknown;
  model_id: string | null;
  model_settings: unknown;
  status: string;
  output: unknown;
  validation: unknown;
  error: string | null;
  latency_ms: number | null;
  total_tokens: number | null;
  created_at: string;
}

function mapPromptRow(row: PromptRow): Omit<TenantPromptSummary, "activeVersionNumber" | "versionCount"> {
  return {
    id: row.id,
    templateKey: row.template_key as PromptTemplateKey,
    name: row.name,
    description: row.description,
    workflow: row.workflow,
    catalogueVersion: row.catalogue_version,
    archivedAt: row.archived_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVersionRow(row: VersionRow): StoredPromptVersion {
  return {
    id: row.id,
    tenantPromptId: row.tenant_prompt_id,
    versionNumber: row.version_number,
    content: row.content,
    inputVariables: (row.input_variables ?? []) as readonly PromptInputVariable[],
    outputFormat: (row.output_format ?? {}) as PromptOutputFormat,
    modelSettings: (row.model_settings ?? {}) as PromptModelSettings,
    status: row.status as StoredVersionStatus,
    changeNote: row.change_note,
    restoredFromVersionId: row.restored_from_version_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    archivedAt: row.archived_at,
  };
}

function mapTestRunRow(row: TestRunRow): StoredTestRun {
  return {
    id: row.id,
    tenantPromptId: row.tenant_prompt_id,
    promptVersionId: row.prompt_version_id,
    inputKind: row.input_kind as "source_items" | "pasted",
    inputPayload: row.input_payload,
    modelId: row.model_id,
    modelSettings: (row.model_settings ?? null) as PromptModelSettings | null,
    status: row.status as "ok" | "failed",
    output: row.output,
    validation: row.validation,
    error: row.error,
    latencyMs: row.latency_ms,
    totalTokens: row.total_tokens,
    createdAt: row.created_at,
  };
}

// --- Resolution (Gateway contract) ---------------------------------------------

/**
 * Build a ResolvedPrompt from a stored version, inheriting fields the DB does
 * not own (agent version, retrieval/source-reference policies) from the
 * in-code default for the same template — so the trust contract is stable.
 */
function resolvedFromStored(
  templateKey: string,
  promptName: string,
  promptDescription: string | null,
  version: StoredPromptVersion,
): ResolvedPrompt {
  const base = fallbackResolve({ promptTemplateId: templateKey });
  return {
    template: {
      promptTemplateId: templateKey,
      agentName: base.template.agentName,
      name: promptName,
      description: promptDescription ?? base.template.description,
      status: "active",
    },
    version: {
      promptVersionId: `${templateKey}@v${version.versionNumber}`,
      promptTemplateId: templateKey,
      promptVersion: `v${version.versionNumber}`,
      agentVersion: base.version.agentVersion,
      systemPrompt: version.content,
      modelPolicy: { policyName: version.modelSettings.policyName ?? base.version.modelPolicy.policyName },
      temperature: version.modelSettings.temperature ?? base.version.temperature,
      maxTokens: version.modelSettings.maxTokens ?? base.version.maxTokens,
      structuredOutputSchemaId: version.outputFormat.schemaId ?? base.version.structuredOutputSchemaId,
      retrievalPolicy: base.version.retrievalPolicy,
      sourceReferencePolicy: base.version.sourceReferencePolicy,
      status: version.status,
      createdAt: version.createdAt,
      promptVersionDbId: version.id,
    },
  };
}

/**
 * DB-backed prompt resolution for the Model Gateway. Never throws and never
 * lets a DB failure break inference: the in-code default is the terminal
 * fallback for every path except an explicit (and unsatisfiable) pin.
 */
export const promptVersioningService: PromptVersioningService = {
  async resolve(ctx: TenantContext, req) {
    // 1) Exact stored-version pin (test runs): any status, tenant-checked.
    if (req.promptVersionId) {
      try {
        const secret = createSupabaseSecretClient();
        const { data, error } = await secret
          .from("prompt_versions")
          .select(`${VERSION_SELECT}, tenant_prompts!inner(template_key, name, description)`)
          .eq("id", req.promptVersionId)
          .eq("tenant_id", ctx.tenantId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) {
          return err(
            new ValidationError("pinned prompt version not found for tenant", {
              promptVersionId: req.promptVersionId,
            }),
          );
        }
        const prompt = data.tenant_prompts as unknown as {
          template_key: string;
          name: string;
          description: string | null;
        };
        return ok(
          resolvedFromStored(
            prompt.template_key,
            prompt.name,
            prompt.description,
            mapVersionRow(data as unknown as VersionRow),
          ),
        );
      } catch (cause) {
        return err(
          new ValidationError("pinned prompt version could not be loaded", {
            promptVersionId: req.promptVersionId,
            cause: cause instanceof Error ? cause.message : String(cause),
          }),
        );
      }
    }

    // 2) The tenant's active version for this template key.
    try {
      const secret = createSupabaseSecretClient();
      const { data, error } = await secret
        .from("prompt_versions")
        .select(`${VERSION_SELECT}, tenant_prompts!inner(template_key, name, description, archived_at)`)
        .eq("tenant_id", ctx.tenantId)
        .eq("status", "active")
        .eq("tenant_prompts.template_key", req.promptTemplateId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data) {
        const prompt = data.tenant_prompts as unknown as {
          template_key: string;
          name: string;
          description: string | null;
          archived_at: string | null;
        };
        if (!prompt.archived_at) {
          const resolved = resolvedFromStored(
            prompt.template_key,
            prompt.name,
            prompt.description,
            mapVersionRow(data as unknown as VersionRow),
          );
          if (req.promptVersion && req.promptVersion !== resolved.version.promptVersion) {
            return err(
              new ValidationError("requested prompt version is not available", {
                promptTemplateId: req.promptTemplateId,
                requested: req.promptVersion,
                available: resolved.version.promptVersion,
              }),
            );
          }
          return ok(resolved);
        }
      }
    } catch (cause) {
      // DB failure must never break inference — fall through to the default.
      console.warn(
        "[prompt-versioning] tenant prompt resolution failed; using in-code default:",
        cause instanceof Error ? cause.message : cause,
      );
    }

    // 3) In-code default / generic fallback (exact pre-DB behaviour).
    const resolved = fallbackResolve(req);
    if (req.promptVersion && req.promptVersion !== resolved.version.promptVersion) {
      return err(
        new ValidationError("requested prompt version is not available", {
          promptTemplateId: req.promptTemplateId,
          requested: req.promptVersion,
          available: resolved.version.promptVersion,
        }),
      );
    }
    return ok(resolved);
  },
};

// --- Seeding --------------------------------------------------------------------

/**
 * Copy the default catalogue into a tenant's library. Idempotent: existing
 * (tenant, template_key) rows are left untouched; version 1 (active) is created
 * only for newly inserted prompts. Used at provisioning and as lazy backfill.
 */
export async function seedTenantPrompts(tenantId: string, userId?: string): Promise<void> {
  const secret = createSupabaseSecretClient();

  const { data: inserted, error } = await secret
    .from("tenant_prompts")
    .upsert(
      DEFAULT_PROMPT_CATALOGUE.map((d) => ({
        tenant_id: tenantId,
        template_key: d.templateKey,
        name: d.name,
        description: d.description,
        workflow: d.workflow,
        catalogue_version: d.catalogueVersion,
        created_by: userId ?? null,
      })),
      { onConflict: "tenant_id,template_key", ignoreDuplicates: true },
    )
    .select("id, template_key");
  if (error) throw new Error(error.message);
  if (!inserted || inserted.length === 0) return;

  const { error: versionError } = await secret.from("prompt_versions").insert(
    inserted.map((row) => {
      const d = DEFAULT_PROMPT_CATALOGUE.find((c) => c.templateKey === row.template_key)!;
      return {
        tenant_id: tenantId,
        tenant_prompt_id: row.id,
        version_number: 1,
        content: d.content,
        input_variables: d.inputVariables,
        output_format: d.outputFormat,
        model_settings: d.modelSettings,
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

// --- Library reads (USER client, RLS-scoped) -------------------------------------

/** List the tenant's prompt library, lazily seeding defaults on first read. */
export async function listTenantPrompts(
  ctx: TenantContext,
): Promise<Result<TenantPromptSummary[]>> {
  const supabase = await createSupabaseServerClient();

  let { data, error } = await supabase
    .from("tenant_prompts")
    .select(PROMPT_SELECT)
    .order("template_key", { ascending: true });
  if (error) return err(new ValidationError(error.message));

  if (!data || data.length === 0) {
    await seedTenantPrompts(ctx.tenantId, ctx.userId);
    ({ data, error } = await supabase
      .from("tenant_prompts")
      .select(PROMPT_SELECT)
      .order("template_key", { ascending: true }));
    if (error) return err(new ValidationError(error.message));
  }

  const { data: versions, error: versionsError } = await supabase
    .from("prompt_versions")
    .select("tenant_prompt_id, version_number, status");
  if (versionsError) return err(new ValidationError(versionsError.message));

  const summaries = ((data ?? []) as PromptRow[]).map((row) => {
    const own = (versions ?? []).filter((v) => v.tenant_prompt_id === row.id);
    const active = own.find((v) => v.status === "active");
    return {
      ...mapPromptRow(row),
      activeVersionNumber: active ? (active.version_number as number) : null,
      versionCount: own.length,
    };
  });
  return ok(summaries);
}

/** One prompt with its full version history (newest first). */
export async function getTenantPrompt(
  ctx: TenantContext,
  id: string,
): Promise<Result<TenantPromptDetail>> {
  const supabase = await createSupabaseServerClient();

  const { data: prompt, error } = await supabase
    .from("tenant_prompts")
    .select(PROMPT_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) return err(new ValidationError(error.message));
  if (!prompt) return err(new ValidationError("prompt not found"));

  const { data: versions, error: versionsError } = await supabase
    .from("prompt_versions")
    .select(VERSION_SELECT)
    .eq("tenant_prompt_id", id)
    .order("version_number", { ascending: false });
  if (versionsError) return err(new ValidationError(versionsError.message));

  return ok({
    ...mapPromptRow(prompt as PromptRow),
    versions: ((versions ?? []) as VersionRow[]).map(mapVersionRow),
  });
}

/** One stored version (tenant-scoped via RLS). */
export async function getPromptVersion(
  ctx: TenantContext,
  versionId: string,
): Promise<Result<StoredPromptVersion & { templateKey: PromptTemplateKey }>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("prompt_versions")
    .select(`${VERSION_SELECT}, tenant_prompts!inner(template_key)`)
    .eq("id", versionId)
    .maybeSingle();
  if (error) return err(new ValidationError(error.message));
  if (!data) return err(new ValidationError("prompt version not found"));
  const templateKey = (data.tenant_prompts as unknown as { template_key: string })
    .template_key as PromptTemplateKey;
  return ok({ ...mapVersionRow(data as unknown as VersionRow), templateKey });
}

/** Recent test runs for one prompt (newest first). */
export async function listTestRuns(
  ctx: TenantContext,
  tenantPromptId: string,
  limit = 10,
): Promise<Result<StoredTestRun[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("prompt_test_runs")
    .select(TEST_RUN_SELECT)
    .eq("tenant_prompt_id", tenantPromptId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return err(new ValidationError(error.message));
  return ok(((data ?? []) as TestRunRow[]).map(mapTestRunRow));
}

// --- Mutations (SECRET client, explicit tenant predicates) -----------------------

/** Guard: the tenant prompt must belong to the caller's tenant. */
async function assertPromptOwned(tenantId: string, tenantPromptId: string): Promise<Result<void>> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("tenant_prompts")
    .select("id")
    .eq("id", tenantPromptId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) return err(new ValidationError(error.message));
  if (!data) return err(new ValidationError("prompt not found for tenant"));
  return ok(undefined);
}

export interface CreateVersionInput {
  readonly tenantPromptId: string;
  readonly content: string;
  readonly inputVariables: readonly PromptInputVariable[];
  readonly outputFormat: PromptOutputFormat;
  readonly modelSettings: PromptModelSettings;
  readonly changeNote?: string;
  readonly restoredFromVersionId?: string;
}

/** Append a new draft version (`version_number = max + 1`). Never overwrites. */
export async function createPromptVersion(
  ctx: TenantContext,
  input: CreateVersionInput,
): Promise<Result<{ versionId: string; versionNumber: number }>> {
  const owned = await assertPromptOwned(ctx.tenantId, input.tenantPromptId);
  if (!owned.ok) return owned;

  const secret = createSupabaseSecretClient();
  const { data: latest, error: maxError } = await secret
    .from("prompt_versions")
    .select("version_number")
    .eq("tenant_prompt_id", input.tenantPromptId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxError) return err(new ValidationError(maxError.message));
  const versionNumber = ((latest?.version_number as number | undefined) ?? 0) + 1;

  const { data, error } = await secret
    .from("prompt_versions")
    .insert({
      tenant_id: ctx.tenantId,
      tenant_prompt_id: input.tenantPromptId,
      version_number: versionNumber,
      content: input.content,
      input_variables: input.inputVariables,
      output_format: input.outputFormat,
      model_settings: input.modelSettings,
      status: "draft",
      change_note: input.changeNote ?? null,
      restored_from_version_id: input.restoredFromVersionId ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) return err(new ValidationError(error?.message ?? "version_create_failed"));
  return ok({ versionId: data.id as string, versionNumber });
}

/** Atomically activate a version (archives the previously active one). */
export async function activatePromptVersion(
  ctx: TenantContext,
  versionId: string,
): Promise<Result<void>> {
  const secret = createSupabaseSecretClient();
  const { error } = await secret.rpc("activate_prompt_version", {
    p_tenant_id: ctx.tenantId,
    p_version_id: versionId,
    p_user_id: ctx.userId,
  });
  if (error) return err(new ValidationError(error.message));
  return ok(undefined);
}

/** Archive a version (allowed for active versions too — resolve then falls back). */
export async function archivePromptVersion(
  ctx: TenantContext,
  versionId: string,
): Promise<Result<void>> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("prompt_versions")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", versionId)
    .eq("tenant_id", ctx.tenantId)
    .select("id");
  if (error) return err(new ValidationError(error.message));
  if (!data || data.length === 0) return err(new ValidationError("prompt version not found"));
  return ok(undefined);
}

/** Update prompt metadata (name/description only — content lives in versions). */
export async function updatePromptMeta(
  ctx: TenantContext,
  id: string,
  input: { name?: string; description?: string },
): Promise<Result<void>> {
  const patch: Record<string, string> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (Object.keys(patch).length === 0) return ok(undefined);

  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("tenant_prompts")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .select("id");
  if (error) return err(new ValidationError(error.message));
  if (!data || data.length === 0) return err(new ValidationError("prompt not found"));
  return ok(undefined);
}

/** Archive/unarchive a whole prompt (resolution then uses the in-code default). */
export async function setPromptArchived(
  ctx: TenantContext,
  id: string,
  archived: boolean,
): Promise<Result<void>> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("tenant_prompts")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .select("id");
  if (error) return err(new ValidationError(error.message));
  if (!data || data.length === 0) return err(new ValidationError("prompt not found"));
  return ok(undefined);
}

export interface RecordTestRunInput {
  readonly id?: string;
  readonly tenantPromptId: string;
  readonly promptVersionId: string;
  readonly inputKind: "source_items" | "pasted";
  readonly inputPayload: unknown;
  readonly modelId: string | null;
  readonly modelSettings: PromptModelSettings | null;
  readonly status: "ok" | "failed";
  readonly output: unknown;
  readonly validation: unknown;
  readonly error: string | null;
  readonly latencyMs: number | null;
  readonly totalTokens: number | null;
}

/** Persist a test run (append-only evidence; failures are valid records). */
export async function recordTestRun(
  ctx: TenantContext,
  input: RecordTestRunInput,
): Promise<Result<{ testRunId: string }>> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("prompt_test_runs")
    .insert({
      ...(input.id ? { id: input.id } : {}),
      tenant_id: ctx.tenantId,
      tenant_prompt_id: input.tenantPromptId,
      prompt_version_id: input.promptVersionId,
      requested_by: ctx.userId,
      input_kind: input.inputKind,
      input_payload: input.inputPayload,
      model_id: input.modelId,
      model_settings: input.modelSettings,
      status: input.status,
      output: input.output,
      validation: input.validation,
      error: input.error,
      latency_ms: input.latencyMs,
      total_tokens: input.totalTokens,
    })
    .select("id")
    .single();
  if (error || !data) return err(new ValidationError(error?.message ?? "test_run_record_failed"));
  return ok({ testRunId: data.id as string });
}
