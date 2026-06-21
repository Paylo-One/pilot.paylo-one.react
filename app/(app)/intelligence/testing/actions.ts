"use server";

/**
 * Server Action for the Testing Lab evaluation (/intelligence/testing).
 *
 * Runs a chosen prompt version against a sample through the governed Model
 * Gateway, optionally runs the live version on the same sample for comparison,
 * then runs an impartial LLM judge that scores the candidate output on the
 * dimensions that matter to an operator. The candidate run + judge scores are
 * persisted as append-only evidence on prompt_test_runs.
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
  getPromptVersion,
  getTenantPrompt,
  recordTestRun,
} from "@/modules/prompt-versioning/server";
import type { PromptTemplateKey } from "@/modules/prompt-versioning";

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

function clamp(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export interface DimensionScore {
  score: number;
  reason: string;
}

export interface PromptEvaluation {
  scores: Record<string, DimensionScore>;
  overall: number;
  verdict: "better" | "similar" | "worse" | "no_comparison";
  summary: string;
}

export interface PromptEvaluationResult {
  readonly ok: boolean;
  readonly error: string | null;
  readonly candidateOutput?: unknown;
  readonly activeOutput?: unknown;
  readonly activeVersionNumber?: number | null;
  readonly evaluation?: PromptEvaluation | null;
  readonly modelId?: string | null;
}

/** Assemble the sample retrieval context (shared with the simple test run). */
async function assembleSample(
  tenantId: string,
  inputKind: "source_items" | "pasted",
  sourceItemIds: readonly string[] | undefined,
  pastedSample: string | undefined,
): Promise<
  { context: RetrievalContextItem[]; sampleText: string } | { error: string }
> {
  if (inputKind === "source_items") {
    const ids = (sourceItemIds ?? []).filter(Boolean).slice(0, 10);
    if (ids.length === 0) return { error: "Select at least one source item." };
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("source_items")
      .select("id, system, title, body, author, occurred_at, created_at")
      .in("id", ids);
    if (error) return { error: error.message };
    const rows = data ?? [];
    if (rows.length === 0) return { error: "No matching source items found." };
    const context = rows.map((item, index) => ({
      sourceItemId: `item-${index + 1}`,
      summary: clamp(
        `(${item.system}) ${item.title ?? "(untitled)"}${item.body ? ` — ${clamp(item.body as string, 500)}` : ""}${item.author ? ` [from: ${item.author}]` : ""}`,
        800,
      ),
      occurredAt: (item.occurred_at ?? item.created_at) as string,
    }));
    const sampleText = context
      .map((c) => `[${c.sourceItemId}] ${c.summary}`)
      .join("\n");
    return { context, sampleText };
  }

  const sample = pastedSample?.trim();
  if (!sample) return { error: "Paste a sample input first." };
  const text = clamp(sample, 2000);
  return {
    context: [
      {
        sourceItemId: "item-1",
        summary: text,
        occurredAt: new Date().toISOString(),
      },
    ],
    sampleText: text,
  };
}

/** Run one stored version against an assembled sample; returns its output. */
async function runVersion(
  ctx: GatewayRequest["ctx"],
  versionId: string,
  templateKey: PromptTemplateKey,
  context: RetrievalContextItem[],
): Promise<
  { ok: true; output: unknown; modelId: string } | { ok: false; error: string }
> {
  const request: GatewayRequest = {
    ctx,
    task: TEMPLATE_TASK[templateKey] ?? "reasoning",
    agentRunId: randomUUID(),
    invocationKind: "test",
    dataClassification: "confidential",
    promptTemplateId: templateKey,
    promptVersionId: versionId,
    retrievalContext: context,
    sourceReferences: [],
    modelPolicy: { policyName: "default" },
    expectedOutputSchema: {
      schemaId: `${templateKey}_output`,
      schemaVersion: "1",
    },
  };
  try {
    const res = await modelGateway.invoke(request);
    if (!res.ok) return { ok: false, error: res.error.message };
    return { ok: true, output: res.value.output, modelId: res.value.modelId };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "gateway_failed",
    };
  }
}

export async function runPromptEvaluationAction(input: {
  versionId: string;
  inputKind: "source_items" | "pasted";
  sourceItemIds?: readonly string[];
  pastedSample?: string;
  compareToActive?: boolean;
}): Promise<PromptEvaluationResult> {
  const ctx = await requireTenantContext();
  if (!input?.versionId)
    return { ok: false, error: "Choose a version to evaluate." };

  const versionRes = await getPromptVersion(ctx, input.versionId);
  if (!versionRes.ok) return { ok: false, error: versionRes.error.message };
  const candidate = versionRes.value;

  const sample = await assembleSample(
    ctx.tenantId,
    input.inputKind,
    input.sourceItemIds,
    input.pastedSample,
  );
  if ("error" in sample) return { ok: false, error: sample.error };

  // 1. Run the candidate version.
  const candidateRun = await runVersion(
    ctx,
    candidate.id,
    candidate.templateKey,
    sample.context,
  );
  if (!candidateRun.ok) return { ok: false, error: candidateRun.error };

  // 2. Optionally run the live (active) version on the same sample.
  let activeOutput: unknown = null;
  let activeVersionNumber: number | null = null;
  let activeVersionId: string | null = null;
  if (input.compareToActive) {
    const detail = await getTenantPrompt(ctx, candidate.tenantPromptId);
    if (detail.ok) {
      const active = detail.value.versions.find((v) => v.status === "active");
      if (active && active.id !== candidate.id) {
        activeVersionId = active.id;
        activeVersionNumber = active.versionNumber;
        const activeRun = await runVersion(
          ctx,
          active.id,
          candidate.templateKey,
          sample.context,
        );
        if (activeRun.ok) activeOutput = activeRun.output;
      }
    }
  }

  // 3. Judge the candidate output (with the live output for comparison).
  const judgeContext: RetrievalContextItem[] = [
    {
      sourceItemId: "item-1",
      summary: clamp(`SAMPLE INPUT:\n${sample.sampleText}`, 2400),
      occurredAt: new Date().toISOString(),
    },
    {
      sourceItemId: "item-2",
      summary: clamp(
        `OUTPUT TO SCORE:\n${JSON.stringify(candidateRun.output)}`,
        2400,
      ),
      occurredAt: new Date().toISOString(),
    },
  ];
  if (activeOutput !== null) {
    judgeContext.push({
      sourceItemId: "item-3",
      summary: clamp(
        `LIVE VERSION OUTPUT:\n${JSON.stringify(activeOutput)}`,
        2400,
      ),
      occurredAt: new Date().toISOString(),
    });
  }

  let evaluation: PromptEvaluation | null = null;
  let judgeModelId: string | null = candidateRun.modelId;
  try {
    const judge = await modelGateway.invoke({
      ctx,
      task: "reasoning",
      agentRunId: randomUUID(),
      invocationKind: "test",
      dataClassification: "confidential",
      promptTemplateId: "prompt_evaluation",
      retrievalContext: judgeContext,
      sourceReferences: [],
      modelPolicy: { policyName: "default" },
      expectedOutputSchema: {
        schemaId: "prompt_evaluation_output",
        schemaVersion: "1",
      },
    });
    if (judge.ok) {
      evaluation = judge.value.output as unknown as PromptEvaluation;
      judgeModelId = judge.value.modelId;
    }
  } catch {
    // A judge failure must not lose the run outputs the operator already has.
    evaluation = null;
  }

  // 4. Persist the candidate run + judge scores as evidence.
  const testRunId = randomUUID();
  await recordTestRun(ctx, {
    id: testRunId,
    tenantPromptId: candidate.tenantPromptId,
    promptVersionId: candidate.id,
    inputKind: input.inputKind,
    inputPayload: sample.context,
    modelId: candidateRun.modelId,
    modelSettings: candidate.modelSettings,
    status: "ok",
    output: candidateRun.output,
    validation: null,
    error: null,
    latencyMs: null,
    totalTokens: null,
    evaluation,
    comparedVersionId: activeVersionId,
  });

  await auditService.record(ctx, {
    action: "prompt.evaluation.run",
    target: candidate.tenantPromptId,
    metadata: {
      templateKey: candidate.templateKey,
      versionId: candidate.id,
      versionNumber: candidate.versionNumber,
      comparedVersionId: activeVersionId,
      overall: evaluation?.overall ?? null,
      verdict: evaluation?.verdict ?? null,
    },
  });
  revalidatePath(`/intelligence/prompts/${candidate.tenantPromptId}`);

  return {
    ok: true,
    error: null,
    candidateOutput: candidateRun.output,
    activeOutput,
    activeVersionNumber,
    evaluation,
    modelId: judgeModelId,
  };
}
