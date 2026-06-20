import "server-only";

/**
 * modules/manager-manifesto/server.ts
 *
 * DB-backed data layer for the Manager Manifesto. Mirrors
 * prompt-versioning/server.ts: reads use the RLS-scoped USER client; mutations
 * use the SECRET client with explicit tenant predicates; the append-only and
 * single-active invariants are enforced in SQL (one-active partial index +
 * activate_manifesto_version RPC), never client-side.
 *
 * `getActiveManifestoBody` is the read used during prompt resolution; it uses
 * the SECRET client (it runs inside the Gateway) and never throws.
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
  DEFAULT_MANIFESTO_BODY,
  DEFAULT_MANIFESTO_CATALOGUE_VERSION,
  DEFAULT_MANIFESTO_PRINCIPLES,
  type ManagerManifestoDetail,
  type ManifestoVersion,
  type ManifestoVersionStatus,
} from "./index";

const MANIFESTO_SELECT = "id, catalogue_version, created_at, updated_at";
const VERSION_SELECT =
  "id, manifesto_id, version_number, body, principles, status, change_note, restored_from_version_id, created_by, created_at, activated_at, archived_at";

interface VersionRow {
  id: string;
  manifesto_id: string;
  version_number: number;
  body: string;
  principles: unknown;
  status: string;
  change_note: string | null;
  restored_from_version_id: string | null;
  created_by: string | null;
  created_at: string;
  activated_at: string | null;
  archived_at: string | null;
}

function mapVersionRow(row: VersionRow): ManifestoVersion {
  return {
    id: row.id,
    manifestoId: row.manifesto_id,
    versionNumber: row.version_number,
    body: row.body,
    principles: (Array.isArray(row.principles)
      ? row.principles
      : []) as readonly string[],
    status: row.status as ManifestoVersionStatus,
    changeNote: row.change_note,
    restoredFromVersionId: row.restored_from_version_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    archivedAt: row.archived_at,
  };
}

/**
 * Seed a tenant's manifesto from the shipped default: the container plus an
 * active version 1. Idempotent — does nothing if one already exists.
 */
export async function seedTenantManifesto(
  tenantId: string,
  userId?: string,
): Promise<void> {
  const secret = createSupabaseSecretClient();
  const { data: existing } = await secret
    .from("manager_manifesto")
    .select("id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (existing) return;

  const { data: created, error } = await secret
    .from("manager_manifesto")
    .insert({
      tenant_id: tenantId,
      catalogue_version: DEFAULT_MANIFESTO_CATALOGUE_VERSION,
      created_by: userId ?? null,
    })
    .select("id")
    .single();
  if (error || !created)
    throw new Error(error?.message ?? "manifesto_seed_failed");

  const { error: versionError } = await secret
    .from("manifesto_versions")
    .insert({
      tenant_id: tenantId,
      manifesto_id: created.id,
      version_number: 1,
      body: DEFAULT_MANIFESTO_BODY,
      principles: DEFAULT_MANIFESTO_PRINCIPLES,
      status: "active",
      change_note: "Seeded from the default manifesto.",
      created_by: userId ?? null,
      activated_at: new Date().toISOString(),
      activated_by: userId ?? null,
    });
  if (versionError) throw new Error(versionError.message);
}

/** The manifesto with its full version history, lazily seeding on first read. */
export async function getManifesto(
  ctx: TenantContext,
): Promise<Result<ManagerManifestoDetail>> {
  const supabase = await createSupabaseServerClient();

  let { data: manifesto, error } = await supabase
    .from("manager_manifesto")
    .select(MANIFESTO_SELECT)
    .maybeSingle();
  if (error) return err(new ValidationError(error.message));

  if (!manifesto) {
    await seedTenantManifesto(ctx.tenantId, ctx.userId);
    ({ data: manifesto, error } = await supabase
      .from("manager_manifesto")
      .select(MANIFESTO_SELECT)
      .maybeSingle());
    if (error) return err(new ValidationError(error.message));
  }
  if (!manifesto)
    return err(new ValidationError("manifesto could not be created"));

  const { data: versions, error: versionsError } = await supabase
    .from("manifesto_versions")
    .select(VERSION_SELECT)
    .eq("manifesto_id", manifesto.id)
    .order("version_number", { ascending: false });
  if (versionsError) return err(new ValidationError(versionsError.message));

  return ok({
    id: manifesto.id as string,
    catalogueVersion: manifesto.catalogue_version as string,
    createdAt: manifesto.created_at as string,
    updatedAt: manifesto.updated_at as string,
    versions: ((versions ?? []) as VersionRow[]).map(mapVersionRow),
  });
}

/**
 * The active manifesto body for a tenant, for prompt-resolution composition.
 * SECRET client (runs inside the Gateway), seeds if missing, never throws —
 * returns null on any failure so inference is never blocked.
 */
export async function getActiveManifestoBody(
  tenantId: string,
): Promise<string | null> {
  try {
    const secret = createSupabaseSecretClient();
    const { data } = await secret
      .from("manifesto_versions")
      .select("body, status, manager_manifesto!inner(tenant_id)")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .maybeSingle();
    if (data?.body) return data.body as string;

    // No active version yet (un-seeded tenant) — seed then re-read.
    await seedTenantManifesto(tenantId);
    const { data: seeded } = await secret
      .from("manifesto_versions")
      .select("body")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .maybeSingle();
    return (seeded?.body as string | undefined) ?? null;
  } catch (cause) {
    console.warn(
      "[manager-manifesto] active body resolution failed; omitting from system prompt:",
      cause instanceof Error ? cause.message : cause,
    );
    return null;
  }
}

/** One stored version (tenant-scoped via RLS). */
export async function getManifestoVersion(
  ctx: TenantContext,
  versionId: string,
): Promise<Result<ManifestoVersion>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("manifesto_versions")
    .select(VERSION_SELECT)
    .eq("id", versionId)
    .maybeSingle();
  if (error) return err(new ValidationError(error.message));
  if (!data) return err(new ValidationError("manifesto version not found"));
  return ok(mapVersionRow(data as VersionRow));
}

export interface CreateManifestoVersionInput {
  readonly manifestoId: string;
  readonly body: string;
  readonly principles?: readonly string[];
  readonly changeNote?: string;
  readonly restoredFromVersionId?: string;
}

/** Append a new draft version (`version_number = max + 1`). Never overwrites. */
export async function createManifestoVersion(
  ctx: TenantContext,
  input: CreateManifestoVersionInput,
): Promise<Result<{ versionId: string; versionNumber: number }>> {
  const secret = createSupabaseSecretClient();

  // Ownership check.
  const { data: owned, error: ownErr } = await secret
    .from("manager_manifesto")
    .select("id")
    .eq("id", input.manifestoId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (ownErr) return err(new ValidationError(ownErr.message));
  if (!owned) return err(new ValidationError("manifesto not found for tenant"));

  const { data: latest, error: maxError } = await secret
    .from("manifesto_versions")
    .select("version_number")
    .eq("manifesto_id", input.manifestoId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxError) return err(new ValidationError(maxError.message));
  const versionNumber =
    ((latest?.version_number as number | undefined) ?? 0) + 1;

  const { data, error } = await secret
    .from("manifesto_versions")
    .insert({
      tenant_id: ctx.tenantId,
      manifesto_id: input.manifestoId,
      version_number: versionNumber,
      body: input.body,
      principles: input.principles ?? [],
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
export async function activateManifestoVersion(
  ctx: TenantContext,
  versionId: string,
): Promise<Result<void>> {
  const secret = createSupabaseSecretClient();
  const { error } = await secret.rpc("activate_manifesto_version", {
    p_tenant_id: ctx.tenantId,
    p_version_id: versionId,
    p_user_id: ctx.userId,
  });
  if (error) return err(new ValidationError(error.message));
  return ok(undefined);
}
