"use server";

/**
 * Server Actions for the tenant prompt library (/prompts).
 *
 * Tenant context is re-derived server-side via requireTenantContext (never
 * trusted from the client). Mutations go through the prompt-versioning server
 * module (secret client, append-only + single-active invariants), every action
 * is audited, and test runs invoke the governed Model Gateway with an explicit
 * version pin so drafts can be exercised safely before activation.
 */

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { auditService } from "@/modules/audit";
import { modelGateway } from "@/modules/model-gateway";
import type {
  GatewayRequest,
  RetrievalContextItem,
} from "@/modules/model-gateway";
import type { ModelTask } from "@/modules/model-catalogue";
import {
  activatePromptVersion,
  archivePromptVersion,
  createPromptVersion,
  getPromptVersion,
  getTenantPrompt,
  recordTestRun,
  resetPromptToDefault,
  setPromptArchived,
  updatePromptMeta,
} from "@/modules/prompt-versioning/server";
import type {
  PromptInputVariable,
  PromptModelSettings,
  PromptOutputFormat,
  PromptTemplateKey,
} from "@/modules/prompt-versioning";

interface ActionResponse {
  readonly ok: boolean;
  readonly error: string | null;
}

function failure(error: string): ActionResponse {
  return { ok: false, error };
}

function revalidatePrompts(promptId?: string): void {
  revalidatePath("/prompts");
  revalidatePath("/intelligence");
  revalidatePath("/intelligence/prompts");
  if (promptId) {
    revalidatePath(`/prompts/${promptId}`);
    revalidatePath(`/intelligence/prompts/${promptId}`);
  }
}

/** The Gateway task each workflow template maps to. */
const TEMPLATE_TASK: Record<PromptTemplateKey, ModelTask> = {
  daily_memo: "reasoning",
  signal_classification: "classification",
  signal_ranking: "priority_scoring",
  signal_triage: "summarisation",
  action_extraction: "action_extraction",
  decision_extraction: "extraction",
  risk_detection: "risk_signal",
  diary_reflection: "reasoning",
  people_memory: "extraction",
  source_processing: "extraction",
  memory_synthesis: "reasoning",
  weekly_operating_review: "reasoning",
};

// --- Version lifecycle --------------------------------------------------------

export async function createPromptVersionAction(input: {
  tenantPromptId: string;
  content: string;
  inputVariables?: readonly PromptInputVariable[];
  outputFormat?: PromptOutputFormat;
  modelSettings?: Partial<PromptModelSettings>;
  changeNote?: string;
}): Promise<ActionResponse & { versionId?: string; versionNumber?: number }> {
  const ctx = await requireTenantContext();
  if (!input?.tenantPromptId) return failure("Missing prompt id.");
  if (!input.content?.trim()) return failure("Prompt content cannot be empty.");

  // Inherit structure the editor did not change from the current latest version.
  const detail = await getTenantPrompt(ctx, input.tenantPromptId);
  if (!detail.ok) return failure(detail.error.message);
  const latest = detail.value.versions[0];
  if (!latest) return failure("Prompt has no versions to inherit from.");

  const result = await createPromptVersion(ctx, {
    tenantPromptId: input.tenantPromptId,
    content: input.content,
    inputVariables: input.inputVariables ?? latest.inputVariables,
    outputFormat: input.outputFormat ?? latest.outputFormat,
    modelSettings: {
      policyName:
        input.modelSettings?.policyName ?? latest.modelSettings.policyName,
      temperature:
        input.modelSettings?.temperature ?? latest.modelSettings.temperature,
      maxTokens:
        input.modelSettings?.maxTokens ?? latest.modelSettings.maxTokens,
    },
    changeNote: input.changeNote?.trim() || undefined,
  });
  if (!result.ok) return failure(result.error.message);

  await auditService.record(ctx, {
    action: "prompt.version.created",
    target: input.tenantPromptId,
    metadata: {
      templateKey: detail.value.templateKey,
      versionId: result.value.versionId,
      versionNumber: result.value.versionNumber,
      changeNote: input.changeNote ?? null,
    },
  });
  revalidatePrompts(input.tenantPromptId);
  return { ok: true, error: null, ...result.value };
}

export async function activatePromptVersionAction(input: {
  versionId: string;
}): Promise<ActionResponse> {
  const ctx = await requireTenantContext();
  if (!input?.versionId) return failure("Missing version id.");

  const version = await getPromptVersion(ctx, input.versionId);
  if (!version.ok) return failure(version.error.message);

  const result = await activatePromptVersion(ctx, input.versionId);
  if (!result.ok) return failure(result.error.message);

  await auditService.record(ctx, {
    action: "prompt.version.activated",
    target: version.value.tenantPromptId,
    metadata: {
      templateKey: version.value.templateKey,
      versionId: input.versionId,
      versionNumber: version.value.versionNumber,
    },
  });
  revalidatePrompts(version.value.tenantPromptId);
  return { ok: true, error: null };
}

export async function archivePromptVersionAction(input: {
  versionId: string;
}): Promise<ActionResponse> {
  const ctx = await requireTenantContext();
  if (!input?.versionId) return failure("Missing version id.");

  const version = await getPromptVersion(ctx, input.versionId);
  if (!version.ok) return failure(version.error.message);

  const result = await archivePromptVersion(ctx, input.versionId);
  if (!result.ok) return failure(result.error.message);

  await auditService.record(ctx, {
    action: "prompt.version.archived",
    target: version.value.tenantPromptId,
    metadata: {
      templateKey: version.value.templateKey,
      versionId: input.versionId,
      versionNumber: version.value.versionNumber,
    },
  });
  revalidatePrompts(version.value.tenantPromptId);
  return { ok: true, error: null };
}

/** Restore = append a new draft version copying the selected one. */
export async function restorePromptVersionAction(input: {
  versionId: string;
}): Promise<ActionResponse & { versionId?: string; versionNumber?: number }> {
  const ctx = await requireTenantContext();
  if (!input?.versionId) return failure("Missing version id.");

  const version = await getPromptVersion(ctx, input.versionId);
  if (!version.ok) return failure(version.error.message);
  const v = version.value;

  const result = await createPromptVersion(ctx, {
    tenantPromptId: v.tenantPromptId,
    content: v.content,
    inputVariables: v.inputVariables,
    outputFormat: v.outputFormat,
    modelSettings: v.modelSettings,
    changeNote: `Restored from version ${v.versionNumber}.`,
    restoredFromVersionId: v.id,
  });
  if (!result.ok) return failure(result.error.message);

  await auditService.record(ctx, {
    action: "prompt.version.restored",
    target: v.tenantPromptId,
    metadata: {
      templateKey: v.templateKey,
      versionId: result.value.versionId,
      versionNumber: result.value.versionNumber,
      restoredFromVersionId: v.id,
      restoredFromVersionNumber: v.versionNumber,
    },
  });
  revalidatePrompts(v.tenantPromptId);
  return { ok: true, error: null, ...result.value };
}

/**
 * Reset a prompt to its shipped default: appends a new active version carrying
 * the default catalogue content + settings and restores the default metadata.
 * Append-only — the prior versions stay in history; this is reversible via the
 * version list. The new active version number is returned for the UI.
 */
export async function resetPromptToDefaultAction(input: {
  promptId: string;
}): Promise<ActionResponse & { versionNumber?: number }> {
  const ctx = await requireTenantContext();
  if (!input?.promptId) return failure("Missing prompt id.");

  const result = await resetPromptToDefault(ctx, input.promptId);
  if (!result.ok) return failure(result.error.message);

  await auditService.record(ctx, {
    action: "prompt.defaults.reset",
    target: input.promptId,
    metadata: {
      templateKey: result.value.templateKey,
      versionId: result.value.versionId,
      versionNumber: result.value.versionNumber,
    },
  });
  revalidatePrompts(input.promptId);
  return { ok: true, error: null, versionNumber: result.value.versionNumber };
}

// --- Prompt metadata ------------------------------------------------------------

export async function updatePromptMetaAction(input: {
  promptId: string;
  name?: string;
  description?: string;
}): Promise<ActionResponse> {
  const ctx = await requireTenantContext();
  if (!input?.promptId) return failure("Missing prompt id.");
  if (input.name !== undefined && !input.name.trim()) {
    return failure("Name cannot be empty.");
  }

  const result = await updatePromptMeta(ctx, input.promptId, {
    name: input.name?.trim(),
    description: input.description?.trim(),
  });
  if (!result.ok) return failure(result.error.message);

  await auditService.record(ctx, {
    action: "prompt.updated",
    target: input.promptId,
    metadata: {
      name: input.name ?? null,
      description: input.description ?? null,
    },
  });
  revalidatePrompts(input.promptId);
  return { ok: true, error: null };
}

export async function setPromptArchivedAction(input: {
  promptId: string;
  archived: boolean;
}): Promise<ActionResponse> {
  const ctx = await requireTenantContext();
  if (!input?.promptId) return failure("Missing prompt id.");

  const result = await setPromptArchived(ctx, input.promptId, input.archived);
  if (!result.ok) return failure(result.error.message);

  await auditService.record(ctx, {
    action: input.archived ? "prompt.archived" : "prompt.unarchived",
    target: input.promptId,
    metadata: {},
  });
  revalidatePrompts(input.promptId);
  return { ok: true, error: null };
}

// --- Test runs -------------------------------------------------------------------

export interface PromptTestResult {
  readonly ok: boolean;
  readonly error: string | null;
  readonly testRunId?: string;
  readonly status?: "ok" | "failed";
  readonly output?: unknown;
  readonly validation?: { passed: boolean; missingKeys: string[] } | null;
  readonly modelId?: string | null;
  readonly latencyMs?: number | null;
}

/** Clamp text so test prompts stay cost-bounded. */
function clamp(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Run a prompt version against sample inputs through the real Model Gateway.
 * The version is pinned explicitly (drafts/archived run too), the invocation is
 * metered with `is_test = true`, and the full result is persisted as evidence.
 */
export async function runPromptTestAction(input: {
  versionId: string;
  inputKind: "source_items" | "pasted";
  sourceItemIds?: readonly string[];
  pastedSample?: string;
}): Promise<PromptTestResult> {
  const ctx = await requireTenantContext();
  if (!input?.versionId) return { ok: false, error: "Missing version id." };

  const versionRes = await getPromptVersion(ctx, input.versionId);
  if (!versionRes.ok) return { ok: false, error: versionRes.error.message };
  const version = versionRes.value;

  // Assemble the sample retrieval context.
  let retrievalContext: RetrievalContextItem[] = [];
  if (input.inputKind === "source_items") {
    const ids = (input.sourceItemIds ?? []).filter(Boolean).slice(0, 10);
    if (ids.length === 0)
      return { ok: false, error: "Select at least one source item." };
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("source_items")
      .select("id, system, title, body, author, occurred_at, created_at")
      .in("id", ids);
    if (error) return { ok: false, error: error.message };
    retrievalContext = (data ?? []).map((item, index) => ({
      sourceItemId: `item-${index + 1}`,
      summary: clamp(
        `(${item.system}) ${item.title ?? "(untitled)"}${item.body ? ` — ${clamp(item.body as string, 500)}` : ""}${item.author ? ` [from: ${item.author}]` : ""}`,
        800,
      ),
      occurredAt: (item.occurred_at ?? item.created_at) as string,
    }));
    if (retrievalContext.length === 0) {
      return { ok: false, error: "No matching source items found." };
    }
  } else {
    const sample = input.pastedSample?.trim();
    if (!sample) return { ok: false, error: "Paste a sample input first." };
    retrievalContext = [
      {
        sourceItemId: "item-1",
        summary: clamp(sample, 2000),
        occurredAt: new Date().toISOString(),
      },
    ];
  }

  const testRunId = randomUUID();
  const gatewayRequest: GatewayRequest = {
    ctx,
    task: TEMPLATE_TASK[version.templateKey] ?? "reasoning",
    agentRunId: testRunId,
    invocationKind: "test",
    dataClassification: "confidential",
    promptTemplateId: version.templateKey,
    promptVersionId: version.id,
    retrievalContext,
    sourceReferences: [],
    modelPolicy: { policyName: version.modelSettings.policyName ?? "default" },
    expectedOutputSchema: {
      schemaId:
        version.outputFormat.schemaId ?? `${version.templateKey}_output`,
      schemaVersion: "1",
    },
  };

  const startedAt = Date.now();
  let status: "ok" | "failed" = "failed";
  let output: unknown = null;
  let validation: { passed: boolean; missingKeys: string[] } | null = null;
  let errorMessage: string | null = null;
  let modelId: string | null = null;

  try {
    const result = await modelGateway.invoke(gatewayRequest);
    if (result.ok) {
      status = "ok";
      output = result.value.output;
      modelId = result.value.modelId;
      const requiredKeys = version.outputFormat.requiredKeys ?? [];
      const missingKeys = requiredKeys.filter(
        (key) => !(key in (result.value.output as Record<string, unknown>)),
      );
      validation = {
        passed: missingKeys.length === 0,
        missingKeys: [...missingKeys],
      };
    } else {
      errorMessage = result.error.message;
    }
  } catch (cause) {
    errorMessage =
      cause instanceof Error
        ? cause.message
        : "model_gateway_invocation_failed";
  }
  const latencyMs = Date.now() - startedAt;

  await recordTestRun(ctx, {
    id: testRunId,
    tenantPromptId: version.tenantPromptId,
    promptVersionId: version.id,
    inputKind: input.inputKind,
    inputPayload: retrievalContext,
    modelId,
    modelSettings: version.modelSettings,
    status,
    output,
    validation,
    error: errorMessage,
    latencyMs,
    totalTokens: null,
  });

  await auditService.record(ctx, {
    action: "prompt.test.run",
    target: version.tenantPromptId,
    metadata: {
      templateKey: version.templateKey,
      versionId: version.id,
      versionNumber: version.versionNumber,
      testRunId,
      status,
    },
  });
  revalidatePrompts(version.tenantPromptId);

  return {
    ok: true,
    error: null,
    testRunId,
    status,
    output,
    validation,
    modelId,
    latencyMs,
  };
}
