import "server-only";

/**
 * modules/tenant-models/server.ts — the bring-your-own-key data layer (ADR-038).
 *
 * The `tenant_model_providers` table holds a SECRET (`api_key`) and is therefore
 * SERVER-ONLY: every read/write here uses the SECRET client with an explicit
 * tenant_id, and the API key never leaves this module except to reach a provider
 * adapter at call time. The UI only ever sees the MASKED projection
 * (`TenantModelProvider` — no key, just a `keyHint`).
 *
 * Verification: a key is not routable until `verifyTenantModelProvider` makes a
 * real, minimal completion through the provider's Gateway adapter and it
 * succeeds. The Model Gateway then routes the tenant's completions to the active,
 * verified provider as a tenant-owned catalogue model (`tenantModelToDescriptor`).
 */

import { ValidationError, err, ok, type Result, type TenantContext } from "@/modules/shared";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { getAdapter } from "@/modules/model-gateway/adapters";
import type { ModelDescriptor, ModelTask } from "@/modules/model-catalogue";
import {
  keyHintFor,
  type TenantModelProvider,
  type TenantModelProviderKind,
  type TenantModelStatus,
} from "./index";

const MASKED_SELECT =
  "id, provider, model_id, display_name, key_hint, status, last_error, last_verified_at, is_active, created_at, updated_at";

/** Completion tasks a BYO frontier model is offered for (no embeddings). */
const BYO_SUPPORTED_TASKS: readonly ModelTask[] = [
  "reasoning",
  "summarisation",
  "classification",
  "extraction",
  "action_extraction",
  "priority_scoring",
  "risk_signal",
];

interface MaskedRow {
  id: string;
  provider: string;
  model_id: string;
  display_name: string;
  key_hint: string;
  status: string;
  last_error: string | null;
  last_verified_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function mapMasked(row: MaskedRow): TenantModelProvider {
  return {
    id: row.id,
    provider: row.provider as TenantModelProviderKind,
    modelId: row.model_id,
    displayName: row.display_name,
    keyHint: row.key_hint,
    status: row.status as TenantModelStatus,
    lastError: row.last_error,
    lastVerifiedAt: row.last_verified_at,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** List the tenant's registered providers, MASKED (no API key). */
export async function listTenantModelProviders(
  ctx: TenantContext,
): Promise<Result<TenantModelProvider[]>> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("tenant_model_providers")
    .select(MASKED_SELECT)
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: true });
  if (error) return err(new ValidationError(error.message));
  return ok(((data ?? []) as MaskedRow[]).map(mapMasked));
}

export interface AddProviderInput {
  readonly provider: TenantModelProviderKind;
  readonly modelId: string;
  readonly displayName?: string;
  readonly apiKey: string;
}

/** Register a new provider (status `untested` until verified). Returns its id. */
export async function addTenantModelProvider(
  ctx: TenantContext,
  input: AddProviderInput,
): Promise<Result<{ id: string }>> {
  const modelId = input.modelId.trim();
  const apiKey = input.apiKey.trim();
  if (!modelId) return err(new ValidationError("Model id is required."));
  if (!apiKey) return err(new ValidationError("API key is required."));
  if (input.provider !== "openai" && input.provider !== "anthropic") {
    return err(new ValidationError("Unsupported provider."));
  }

  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("tenant_model_providers")
    .insert({
      tenant_id: ctx.tenantId,
      provider: input.provider,
      model_id: modelId,
      display_name: input.displayName?.trim() || modelId,
      api_key: apiKey,
      key_hint: keyHintFor(apiKey),
      status: "untested",
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) return err(new ValidationError(error?.message ?? "provider_create_failed"));
  return ok({ id: data.id as string });
}

/** Guard: the provider row must belong to the caller's tenant. Returns it. */
async function ownedRow(
  tenantId: string,
  id: string,
): Promise<Result<{ provider: TenantModelProviderKind; model_id: string; api_key: string; status: string }>> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("tenant_model_providers")
    .select("provider, model_id, api_key, status")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) return err(new ValidationError(error.message));
  if (!data) return err(new ValidationError("provider not found for tenant"));
  return ok(
    data as { provider: TenantModelProviderKind; model_id: string; api_key: string; status: string },
  );
}

/** Delete a provider (also clears it as the active routing choice). */
export async function deleteTenantModelProvider(
  ctx: TenantContext,
  id: string,
): Promise<Result<void>> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("tenant_model_providers")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .select("id");
  if (error) return err(new ValidationError(error.message));
  if (!data || data.length === 0) return err(new ValidationError("provider not found"));
  return ok(undefined);
}

/**
 * Make this provider the tenant's active routing choice (it must be verified).
 * Deactivates any other active provider first so the single-active partial
 * unique index never conflicts.
 */
export async function setActiveTenantModelProvider(
  ctx: TenantContext,
  id: string,
): Promise<Result<void>> {
  const owned = await ownedRow(ctx.tenantId, id);
  if (!owned.ok) return owned;
  if (owned.value.status !== "verified") {
    return err(new ValidationError("Verify the key before making it active."));
  }

  const secret = createSupabaseSecretClient();
  const { error: clearError } = await secret
    .from("tenant_model_providers")
    .update({ is_active: false })
    .eq("tenant_id", ctx.tenantId)
    .eq("is_active", true);
  if (clearError) return err(new ValidationError(clearError.message));

  const { error } = await secret
    .from("tenant_model_providers")
    .update({ is_active: true })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return err(new ValidationError(error.message));
  return ok(undefined);
}

/** Stop routing through BYO — revert the workspace to the Paylo-hosted default. */
export async function deactivateTenantModelProviders(
  ctx: TenantContext,
): Promise<Result<void>> {
  const secret = createSupabaseSecretClient();
  const { error } = await secret
    .from("tenant_model_providers")
    .update({ is_active: false })
    .eq("tenant_id", ctx.tenantId)
    .eq("is_active", true);
  if (error) return err(new ValidationError(error.message));
  return ok(undefined);
}

/**
 * Verify a provider by making a minimal real completion through its adapter with
 * the stored key. On success the row is marked `verified`; on failure `failed`
 * with the provider error captured. Never throws — the outcome is the Result.
 */
export async function verifyTenantModelProvider(
  ctx: TenantContext,
  id: string,
): Promise<Result<{ status: TenantModelStatus; error: string | null }>> {
  const owned = await ownedRow(ctx.tenantId, id);
  if (!owned.ok) return owned;
  const { provider, model_id, api_key } = owned.value;

  let status: TenantModelStatus = "failed";
  let lastError: string | null = null;
  try {
    const adapter = getAdapter(provider);
    const result = await adapter.complete({
      params: { modelId: model_id, temperature: 0, maxTokens: 16, apiKey: api_key },
      systemPrompt: "You are a connectivity probe. Reply with a single JSON object.",
      userPrompt: 'Return exactly {"ok":true} and nothing else.',
    });
    // Success = the provider accepted the key + model and returned content.
    status = result.content.trim().length > 0 ? "verified" : "failed";
    if (status === "failed") lastError = "Provider returned an empty response.";
  } catch (cause) {
    status = "failed";
    lastError = cause instanceof Error ? cause.message : "Verification call failed.";
  }

  const secret = createSupabaseSecretClient();
  const patch: Record<string, unknown> = {
    status,
    last_error: lastError,
    last_verified_at: status === "verified" ? new Date().toISOString() : null,
  };
  // A key that no longer verifies must not keep routing the workspace.
  if (status === "failed") patch.is_active = false;
  const { error } = await secret
    .from("tenant_model_providers")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return err(new ValidationError(error.message));
  return ok({ status, error: lastError });
}

/** Full row including the API key. Server-only — for the Gateway route stage. */
export interface ActiveProviderWithKey {
  readonly id: string;
  readonly provider: TenantModelProviderKind;
  readonly modelId: string;
  readonly displayName: string;
  readonly apiKey: string;
}

/**
 * The tenant's active, verified provider WITH its key — or null when the
 * workspace uses the Paylo-hosted default. SERVER-ONLY; the key is passed
 * straight to the adapter and never surfaced elsewhere.
 */
export async function getActiveModelProviderWithKey(
  ctx: TenantContext,
): Promise<ActiveProviderWithKey | null> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("tenant_model_providers")
    .select("id, provider, model_id, display_name, api_key")
    .eq("tenant_id", ctx.tenantId)
    .eq("is_active", true)
    .eq("status", "verified")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id as string,
    provider: data.provider as TenantModelProviderKind,
    modelId: data.model_id as string,
    displayName: data.display_name as string,
    apiKey: data.api_key as string,
  };
}

/**
 * Build the tenant-owned catalogue descriptor for a BYO provider. Cost profile
 * is zero — the tenant is billed by their own provider directly, so Paylo does
 * not attribute spend to them (token counts are still metered for visibility).
 */
export function tenantModelToDescriptor(
  provider: TenantModelProviderKind,
  modelId: string,
): ModelDescriptor {
  return {
    modelId,
    provider,
    runtimeType: provider,
    displayName: `${provider === "anthropic" ? "Anthropic" : "OpenAI"} ${modelId} (your key)`,
    baseModel: modelId,
    modelVersion: "byo",
    contextWindow: 128_000,
    supportedTasks: BYO_SUPPORTED_TASKS,
    supportsStructuredOutput: true,
    supportsEmbeddings: false,
    supportsToolCalls: true,
    costProfile: { inputPer1kUsd: 0, outputPer1kUsd: 0 },
    latencyProfile: { typicalMs: 1500, p95Ms: 4000 },
    dataPolicy: { maxDataClassification: "restricted", noTrainingOnInputs: true },
    ownerType: "tenant",
    status: "active",
  };
}
