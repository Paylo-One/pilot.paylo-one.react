import "server-only";

/**
 * modules/agent-orchestration — runs embedded agents (per tenant).
 * Governance: services/agent-orchestration.md, ai-agent-architecture.md,
 * product/daily-memo.md, product/actions.md.
 *
 * The agent flow: build tenant-filtered context (Knowledge Store) -> resolve
 * prompt version + call the Paylo Model Gateway (policy -> entitlement -> route
 * -> validate -> meter) -> validate the domain output schema + attach >=1
 * source reference per insight -> persist tenant-scoped. Agents never call
 * providers, vLLM, or MCP servers directly.
 *
 * MVP: the Daily Memo agent is implemented end-to-end (real OpenAI via the
 * Gateway). Persistence uses the secret client (RLS forbids end users from
 * inserting briefings/sections/source_references) with an explicit tenant_id.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AppError,
  NotImplementedError,
  ValidationError,
  err,
  ok,
  type Result,
  type TenantContext,
} from "@/modules/shared";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import {
  listMemoSourceItems,
  listRecentSourceItems,
  type StoredSourceItem,
} from "@/modules/knowledge-store/server";
import { auditService } from "@/modules/audit";
import {
  modelGateway,
  type GatewayRequest,
  type RetrievalContextItem,
} from "@/modules/model-gateway";
import { appendExternalSignalsToBriefing } from "@/modules/news/briefing";
import { dedupeAndPersistSuggestedActions } from "@/modules/action-extraction/dedupe";
import { recordNotification } from "@/modules/notification/server";
import { checkBriefingLimit } from "@/modules/briefing/server";
import {
  buildAttributedMemoPayload,
  buildAttributedSuggestedActions,
  clamp,
  partitionAttributedExtractions,
} from "./memo-attribution";

export type AgentKind =
  | "daily_memo"
  | "signal_classification"
  | "signal_ranking"
  | "signal_triage"
  | "action_extraction"
  | "decision_extraction"
  | "risk_detection"
  | "diary_reflection"
  | "people_memory"
  | "topic_synthesis"
  | "weekly_operating_review"
  | "intelligence_batch"
  | "priority_scoring"
  | "risk_signal"
  | "source_attribution";

export interface AgentRunRequest {
  readonly kind: AgentKind;
  readonly input?: Record<string, unknown>;
}

export interface AgentRunResult {
  readonly agentRunId: string;
  readonly kind: AgentKind;
  /** The briefing produced by a daily_memo run, when one was created. */
  readonly briefingId?: string;
}

export interface AgentOrchestrationService {
  run(
    ctx: TenantContext,
    req: AgentRunRequest,
  ): Promise<Result<AgentRunResult>>;
}

/** How many recent items to consider for a Daily Memo run. */
const MEMO_ITEM_LIMIT = 25;

/** Strict domain schema for the Daily Memo agent's structured output. */
const MemoSectionSchema = z.object({
  kind: z.string().min(1),
  title: z.string().min(1),
  body: z.string().default(""),
  sourceItemIds: z.array(z.string()).optional().default([]),
  confidence: z.number().min(0).max(1).optional(),
});

const MemoActionSchema = z.object({
  title: z.string().min(1),
  rationale: z.string().optional().default(""),
  sourceItemIds: z.array(z.string()).optional().default([]),
});

const MemoSchema = z.object({
  summary: z.string().default(""),
  sections: z.array(MemoSectionSchema).default([]),
  actions: z.array(MemoActionSchema).default([]),
});

type Memo = z.infer<typeof MemoSchema>;

/** A condensed, model-facing summary of a source item (summaries over raw). */
function itemSummary(item: StoredSourceItem): string {
  const head = item.title ? `${item.title}` : "(untitled)";
  const body = item.body ? ` — ${clamp(item.body, 500)}` : "";
  const author = item.author ? ` [from: ${item.author}]` : "";
  return clamp(`(${item.system}) ${head}${body}${author}`, 800);
}

async function appendNewsSafely(
  tenantId: string,
  briefingId: string,
  position: number,
): Promise<{ count: number; error: string | null }> {
  try {
    return {
      count: await appendExternalSignalsToBriefing(
        tenantId,
        briefingId,
        position,
      ),
      error: null,
    };
  } catch (cause) {
    return {
      count: 0,
      error: cause instanceof Error ? cause.message : "external_signals_failed",
    };
  }
}

/**
 * Persist a minimal, honest "quiet day" memo when there is nothing to
 * synthesise. No source references are attached because there are no items to
 * cite (the trust contract requires references only where claims draw on items).
 */
async function persistQuietDayMemo(
  ctx: TenantContext,
  agentRunId: string,
): Promise<Result<AgentRunResult>> {
  const secret = createSupabaseSecretClient();
  const summary =
    "A quiet day. No new items have arrived from your connected channels since the last briefing.";

  // Persist the briefing + its single section atomically (see persist_daily_memo).
  const { data: persistedId, error: persistErr } = await secret.rpc(
    "persist_daily_memo",
    {
      p_tenant_id: ctx.tenantId,
      p_summary: summary,
      p_prompt_version_id: null,
      p_sections: [
        {
          kind: "executive_summary",
          position: 0,
          title: "A quiet day",
          body: "Nothing new has come in from your connected channels. Connect a source or capture a note — your next briefing will pick it up automatically.",
          references: [],
        },
      ],
      p_actions: [],
    },
  );
  if (persistErr || !persistedId) {
    return err(
      new AppError("internal", persistErr?.message ?? "briefing_create_failed"),
    );
  }
  const briefingId = persistedId as string;

  const news = await appendNewsSafely(ctx.tenantId, briefingId, 1);
  await auditService.record(ctx, {
    action: "briefing.generated",
    target: briefingId,
    metadata: {
      kind: "daily_memo",
      itemsConsidered: 0,
      sections: 1 + (news.count > 0 ? 1 : 0),
      actions: 0,
      externalSignals: news.count,
      externalSignalsError: news.error,
    },
  });

  return ok({ agentRunId, kind: "daily_memo", briefingId });
}

/**
 * Persist a synthesised memo: the briefing, its ordered sections, the suggested
 * actions, and a source reference for every section/action, mapped from the
 * model's item id tokens.
 *
 * Trust contract: a section/action that cannot be attributed to a real retrieved
 * item is DROPPED rather than back-filled with an unrelated item as false
 * provenance ("if an insight cannot be attributed, it is not shown" —
 * governance daily-memo.md / ai-agent-architecture.md Source Attribution). If
 * nothing survives attribution, we fall back to the honest "quiet day" memo.
 */
async function persistMemo(
  ctx: TenantContext,
  agentRunId: string,
  memo: Memo,
  tokenToItem: Map<string, StoredSourceItem>,
  itemsConsidered: number,
  promptVersionDbId: string | null,
): Promise<Result<AgentRunResult>> {
  const secret = createSupabaseSecretClient();

  // Resolve references and drop any unattributed section/action (see contract above).
  const { sections: sectionsPayload, actions: actionsPayload, droppedSections, droppedActions } =
    buildAttributedMemoPayload(memo, tokenToItem);

  // If the model produced nothing that can be honestly attributed to a real
  // item, do not ship an empty or fabricated memo — surface the honest quiet-day
  // memo instead.
  if (sectionsPayload.length === 0) {
    return persistQuietDayMemo(ctx, agentRunId);
  }

  // Persist the briefing, sections, actions, and references atomically: a single
  // DB function runs in its own transaction, so a failure on any insert rolls the
  // whole memo back rather than leaving a partial briefing (see persist_daily_memo).
  const { data: persistedId, error: persistErr } = await secret.rpc(
    "persist_daily_memo",
    {
      p_tenant_id: ctx.tenantId,
      p_summary: memo.summary,
      p_prompt_version_id: promptVersionDbId,
      p_sections: sectionsPayload,
      p_actions: actionsPayload,
    },
  );
  if (persistErr || !persistedId) {
    return err(
      new AppError("internal", persistErr?.message ?? "memo_persist_failed"),
    );
  }
  const briefingId = persistedId as string;

  const news = await appendNewsSafely(
    ctx.tenantId,
    briefingId,
    sectionsPayload.length,
  );
  await auditService.record(ctx, {
    action: "briefing.generated",
    target: briefingId,
    metadata: {
      kind: "daily_memo",
      itemsConsidered,
      sections: sectionsPayload.length + (news.count > 0 ? 1 : 0),
      actions: actionsPayload.length,
      // Attribution coverage: how many model outputs were withheld for lacking a
      // real source reference (trust-contract observability).
      droppedSections,
      droppedActions,
      promptVersionId: promptVersionDbId,
      externalSignals: news.count,
      externalSignalsError: news.error,
    },
  });

  return ok({ agentRunId, kind: "daily_memo", briefingId });
}

/** The Daily Memo agent: retrieve -> Gateway -> validate -> persist. */
async function runDailyMemo(
  ctx: TenantContext,
): Promise<Result<AgentRunResult>> {
  const agentRunId = randomUUID();

  // Billing capability check (observe-only)
  await checkBriefingLimit(ctx);

  const items = await listMemoSourceItems(ctx.tenantId, MEMO_ITEM_LIMIT);
  if (items.length === 0) {
    return persistQuietDayMemo(ctx, agentRunId);
  }

  // Map stable id tokens (item-1, item-2, …) to real items for reference
  // mapping, and build the tenant-filtered retrieval context for the Gateway.
  const tokenToItem = new Map<string, StoredSourceItem>();
  const retrievalContext: RetrievalContextItem[] = items.map((item, index) => {
    const token = `item-${index + 1}`;
    tokenToItem.set(token, item);
    return {
      sourceItemId: token,
      summary: itemSummary(item),
      occurredAt: item.occurredAt ?? item.createdAt,
    };
  });

  const gatewayRequest: GatewayRequest = {
    ctx,
    task: "reasoning",
    agentRunId,
    dataClassification: "confidential",
    promptTemplateId: "daily_memo",
    retrievalContext,
    sourceReferences: [],
    modelPolicy: { policyName: "daily-memo-synthesis" },
    expectedOutputSchema: { schemaId: "daily_memo_output", schemaVersion: "1" },
  };

  let gatewayResult;
  try {
    gatewayResult = await modelGateway.invoke(gatewayRequest);
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : "model_gateway_invocation_failed";
    return err(new AppError("internal", message));
  }
  if (!gatewayResult.ok) return gatewayResult;

  // Validate the domain output schema (the Gateway only validated it as JSON).
  const parsed = MemoSchema.safeParse(gatewayResult.value.output);
  if (!parsed.success) {
    return err(
      new ValidationError("daily memo output failed schema validation", {
        issues: parsed.error.issues,
      }),
    );
  }

  return persistMemo(
    ctx,
    agentRunId,
    parsed.data,
    tokenToItem,
    items.length,
    gatewayResult.value.promptVersionDbId,
  );
}

// ===========================================================================
// Intelligence pipelines — classification + extraction over recent items.
//
// Each follows the daily-memo skeleton: build a tenant-filtered, tokenised
// retrieval context -> resolve the tenant's active prompt (which composes the
// Manager Manifesto + linked skills) and call the governed Gateway -> validate
// the domain schema -> persist tenant-scoped via the secret client -> audit.
// ===========================================================================

/** How many recent items to feed batch extraction. */
const BATCH_ITEM_LIMIT = 20;
/** How many unclassified items to classify per run (cost bound). */
const CLASSIFY_LIMIT = 15;

function buildContext(items: readonly StoredSourceItem[]): {
  context: RetrievalContextItem[];
  tokenToItem: Map<string, StoredSourceItem>;
} {
  const tokenToItem = new Map<string, StoredSourceItem>();
  const context = items.map((item, index) => {
    const token = `item-${index + 1}`;
    tokenToItem.set(token, item);
    return {
      sourceItemId: token,
      summary: itemSummary(item),
      occurredAt: item.occurredAt ?? item.createdAt,
    };
  });
  return { context, tokenToItem };
}

const ActionsSchema = z.object({
  actions: z
    .array(
      z.object({
        title: z.string().min(1),
        rationale: z.string().optional().default(""),
        owner: z.string().optional().default(""),
        dueAt: z.string().optional().default(""),
        sourceItemIds: z.array(z.string()).optional().default([]),
      }),
    )
    .default([]),
});

const DecisionsSchema = z.object({
  decisions: z
    .array(
      z.object({
        title: z.string().min(1),
        rationale: z.string().optional().default(""),
        context: z.string().optional().default(""),
        status: z.string().optional().default("made"),
        sourceItemIds: z.array(z.string()).optional().default([]),
      }),
    )
    .default([]),
});

const RisksSchema = z.object({
  risks: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().optional().default(""),
        category: z.string().optional().default("operational"),
        severity: z.string().optional().default("medium"),
        likelihood: z.string().optional().default("possible"),
        sourceItemIds: z.array(z.string()).optional().default([]),
      }),
    )
    .default([]),
});

const ThemesSchema = z.object({
  themes: z
    .array(
      z.object({
        label: z.string().min(1),
        throughLine: z.string().optional().default(""),
      }),
    )
    .default([]),
});

const ClassificationSchema = z.object({
  category: z.string().min(1),
  importance: z.number().min(0).max(1).optional().default(0),
  urgency: z.number().min(0).max(1).optional().default(0),
  actionRequired: z.boolean().optional().default(false),
  linkedPeople: z.array(z.string()).optional().default([]),
  topics: z.array(z.string()).optional().default([]),
  confidence: z.number().min(0).max(1).optional().default(0),
  rationale: z.string().optional().default(""),
});

const VALID_CATEGORY = new Set([
  "decision_request",
  "fyi",
  "risk",
  "commitment",
  "question",
  "noise",
]);
const VALID_SEVERITY = new Set(["critical", "high", "medium", "low"]);
const VALID_LIKELIHOOD = new Set([
  "certain",
  "very_likely",
  "likely",
  "possible",
  "unlikely",
]);
const VALID_DECISION_STATUS = new Set(["open", "made", "deferred", "reversed"]);

const RankingSchema = z.object({
  ranked: z
    .array(
      z.object({
        itemId: z.string().min(1),
        priorityScore: z.number().min(0).max(1).optional().default(0),
        tier: z.string().optional().default("background"),
        reason: z.string().optional().default(""),
      }),
    )
    .default([]),
});

const TriageSchema = z.object({
  summary: z.string().optional().default(""),
  groups: z
    .array(
      z.object({
        theme: z.string().min(1),
        itemIds: z.array(z.string()).optional().default([]),
        recommendedAction: z.string().optional().default("ignore"),
        urgency: z.string().optional().default("none"),
        draftNote: z.string().optional().default(""),
      }),
    )
    .default([]),
});

const PeopleSchema = z.object({
  people: z
    .array(
      z.object({
        name: z.string().min(1),
        commitments: z.array(z.string()).optional().default([]),
        concerns: z.array(z.string()).optional().default([]),
        context: z.string().optional().default(""),
        sourceItemIds: z.array(z.string()).optional().default([]),
      }),
    )
    .default([]),
});

const DiarySchema = z.object({
  reflection: z.string().optional().default(""),
  recurringThemes: z.array(z.string()).optional().default([]),
  decisions: z.array(z.string()).optional().default([]),
  risks: z.array(z.string()).optional().default([]),
  nextWeekAttention: z.array(z.string()).optional().default([]),
});

const ReviewSchema = z.object({
  summary: z.string().optional().default(""),
  moved: z.array(z.string()).optional().default([]),
  stalled: z.array(z.string()).optional().default([]),
  decisions: z.array(z.string()).optional().default([]),
  openRisks: z.array(z.string()).optional().default([]),
  nextFocus: z.array(z.string()).optional().default([]),
});

const VALID_TIER = new Set(["act_now", "today", "this_week", "background"]);
const VALID_RECOMMENDED_ACTION = new Set([
  "respond",
  "delegate",
  "schedule",
  "escalate",
  "turn_into_action",
  "ignore",
]);
const VALID_GROUP_URGENCY = new Set(["now", "today", "this_week", "none"]);

/** The Monday (UTC) that starts the week containing `base`, as YYYY-MM-DD. */
function weekStartDate(base = new Date()): string {
  const d = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()),
  );
  const dow = d.getUTCDay(); // 0 = Sun
  const diff = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function invoke(
  ctx: TenantContext,
  task: GatewayRequest["task"],
  templateKey: string,
  context: RetrievalContextItem[],
) {
  const request: GatewayRequest = {
    ctx,
    task,
    agentRunId: randomUUID(),
    dataClassification: "confidential",
    promptTemplateId: templateKey,
    retrievalContext: context,
    sourceReferences: [],
    modelPolicy: { policyName: "default" },
    expectedOutputSchema: {
      schemaId: `${templateKey}_output`,
      schemaVersion: "1",
    },
  };
  return modelGateway.invoke(request);
}

/** Classify recent items that do not yet have a signal; upsert into `signals`. */
async function runSignalClassification(
  ctx: TenantContext,
): Promise<Result<AgentRunResult>> {
  const agentRunId = randomUUID();
  const secret = createSupabaseSecretClient();
  const items = await listRecentSourceItems(ctx.tenantId, BATCH_ITEM_LIMIT);
  if (items.length === 0)
    return ok({ agentRunId, kind: "signal_classification" });

  // Skip items already classified.
  const { data: existing } = await secret
    .from("signals")
    .select("source_item_id")
    .eq("tenant_id", ctx.tenantId)
    .in(
      "source_item_id",
      items.map((i) => i.id),
    );
  const done = new Set((existing ?? []).map((r) => r.source_item_id as string));
  const todo = items.filter((i) => !done.has(i.id)).slice(0, CLASSIFY_LIMIT);

  let classified = 0;
  let failedWrites = 0;
  for (const item of todo) {
    const { context } = buildContext([item]);
    let result;
    try {
      result = await invoke(
        ctx,
        "classification",
        "signal_classification",
        context,
      );
    } catch {
      continue;
    }
    if (!result.ok) continue;
    const parsed = ClassificationSchema.safeParse(result.value.output);
    if (!parsed.success) continue;
    const c = parsed.data;
    const category = VALID_CATEGORY.has(c.category) ? c.category : "noise";
    // Count only what actually lands: a fire-and-forget upsert would report the
    // item as `classified` even when the write failed, silently losing the
    // classification and inflating the audited count. One bad item never aborts
    // the batch ("never throws on one bad item") — it is tallied under
    // `failedWrites` so a persistent failure is observable, not invisible.
    const { error } = await secret.from("signals").upsert(
      {
        tenant_id: ctx.tenantId,
        source_item_id: item.id,
        category,
        importance: c.importance,
        urgency: c.urgency,
        action_required: c.actionRequired,
        linked_people: c.linkedPeople,
        topics: c.topics,
        confidence: c.confidence,
        rationale: c.rationale,
        prompt_version_id: result.value.promptVersionDbId,
        classified_at: new Date().toISOString(),
      },
      { onConflict: "source_item_id" },
    );
    if (error) {
      failedWrites += 1;
      continue;
    }
    classified += 1;
  }

  await auditService.record(ctx, {
    action: "pipeline.classification.run",
    target: ctx.tenantId,
    metadata: { classified, considered: todo.length, failedWrites },
  });
  return ok({ agentRunId, kind: "signal_classification" });
}

/** Extract actions from the recent batch into `suggested_actions`. */
async function runActionExtraction(
  ctx: TenantContext,
): Promise<Result<AgentRunResult>> {
  const agentRunId = randomUUID();
  const secret = createSupabaseSecretClient();
  const items = await listRecentSourceItems(ctx.tenantId, BATCH_ITEM_LIMIT);
  if (items.length === 0) return ok({ agentRunId, kind: "action_extraction" });
  const { context, tokenToItem } = buildContext(items);

  let result;
  try {
    result = await invoke(
      ctx,
      "action_extraction",
      "action_extraction",
      context,
    );
  } catch (cause) {
    return err(
      new AppError(
        "internal",
        cause instanceof Error ? cause.message : "action_extraction_failed",
      ),
    );
  }
  if (!result.ok) return result;
  const parsed = ActionsSchema.safeParse(result.value.output);
  if (!parsed.success) return ok({ agentRunId, kind: "action_extraction" });

  // Resolve each extracted action to REAL source references and DROP any that
  // cannot be attributed — an unattributed suggestion in the Actions inbox is
  // the same PR-1 trust failure the memo/decision/risk paths already guard
  // against (governance decision log 2026-07-20).
  const { actions, droppedUnattributed } = buildAttributedSuggestedActions(
    parsed.data.actions.map((a) => ({
      title: clamp(a.title, 200),
      rationale: clamp(a.rationale, 1000),
      dueAt:
        a.dueAt && !Number.isNaN(Date.parse(a.dueAt))
          ? new Date(a.dueAt).toISOString()
          : null,
      sourceItemIds: a.sourceItemIds,
    })),
    tokenToItem,
  );

  // Semantic dedupe against open actions, then persist. Confident duplicates
  // enrich the existing action's references instead of re-entering the inbox;
  // uncertain matches are inserted flagged for merge review, never merged
  // silently. Each write stays atomic (action + references in one RPC call).
  let dedupeSummary = {
    dedupeApplied: false,
    inserted: 0,
    enriched: 0,
    flaggedForReview: 0,
    decisions: [] as readonly unknown[],
  };
  if (actions.length > 0) {
    try {
      dedupeSummary = await dedupeAndPersistSuggestedActions(ctx, actions);
    } catch (cause) {
      return err(
        new AppError(
          "internal",
          cause instanceof Error ? cause.message : "action_persist_failed",
        ),
      );
    }
  }

  // One quiet review cue per extraction run that actually added something.
  if (dedupeSummary.inserted > 0 && ctx.userId) {
    try {
      await recordNotification({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        kind: "actions_to_review",
        title:
          dedupeSummary.inserted === 1
            ? "1 suggested action needs your review."
            : `${dedupeSummary.inserted} suggested actions need your review.`,
        href: "/actions",
        dedupeKey: agentRunId,
      });
    } catch {
      // A nudge failure never blocks the pipeline.
    }
  }

  await auditService.record(ctx, {
    action: "pipeline.action_extraction.run",
    target: ctx.tenantId,
    // Attribution coverage (how many extractions were withheld for lacking a
    // real source reference) plus every dedupe decision, so a merged or
    // review-flagged candidate is always on record.
    metadata: {
      extracted: actions.length,
      droppedUnattributed,
      dedupeApplied: dedupeSummary.dedupeApplied,
      inserted: dedupeSummary.inserted,
      enrichedExisting: dedupeSummary.enriched,
      flaggedForReview: dedupeSummary.flaggedForReview,
      dedupeDecisions: dedupeSummary.decisions,
    },
  });
  return ok({ agentRunId, kind: "action_extraction" });
}

/** Extract decisions from the recent batch into `decisions`. */
async function runDecisionExtraction(
  ctx: TenantContext,
): Promise<Result<AgentRunResult>> {
  const agentRunId = randomUUID();
  const secret = createSupabaseSecretClient();
  const items = await listRecentSourceItems(ctx.tenantId, BATCH_ITEM_LIMIT);
  if (items.length === 0)
    return ok({ agentRunId, kind: "decision_extraction" });
  const { context, tokenToItem } = buildContext(items);

  let result;
  try {
    result = await invoke(ctx, "extraction", "decision_extraction", context);
  } catch (cause) {
    return err(
      new AppError(
        "internal",
        cause instanceof Error ? cause.message : "decision_extraction_failed",
      ),
    );
  }
  if (!result.ok) return result;
  const parsed = DecisionsSchema.safeParse(result.value.output);
  if (!parsed.success) return ok({ agentRunId, kind: "decision_extraction" });

  // Trust contract: a decision the model cannot attribute to a REAL retrieved
  // item is dropped, not written unattributed into the decision log (2026-07-20).
  const { attributed, dropped } = partitionAttributedExtractions(
    parsed.data.decisions,
    tokenToItem,
  );
  const rows = attributed.map(({ item: d, sourceItemId }) => ({
    tenant_id: ctx.tenantId,
    title: clamp(d.title, 200),
    rationale: clamp(d.rationale, 2000),
    context: clamp(d.context, 2000),
    status: VALID_DECISION_STATUS.has(d.status) ? d.status : "made",
    decided_at: new Date().toISOString(),
    source_item_id: sourceItemId,
    prompt_version_id: result.value.promptVersionDbId,
  }));
  // Check the write before auditing: a fire-and-forget insert would record
  // `extracted: rows.length` as grounded/kept even if the rows never landed,
  // inflating the grounding-coverage summary (attribution-coverage.ts) and
  // losing decisions silently. Mirror the hardened action path (persist error →
  // return before the audit record) so a false "kept" count is never recorded.
  if (rows.length > 0) {
    const { error } = await secret.from("decisions").insert(rows);
    if (error) {
      return err(
        new AppError("internal", error.message ?? "decision_persist_failed"),
      );
    }
  }

  await auditService.record(ctx, {
    action: "pipeline.decision_extraction.run",
    target: ctx.tenantId,
    metadata: { extracted: rows.length, droppedUnattributed: dropped },
  });
  return ok({ agentRunId, kind: "decision_extraction" });
}

/** Detect risks across the recent batch into `risks`. */
async function runRiskDetection(
  ctx: TenantContext,
): Promise<Result<AgentRunResult>> {
  const agentRunId = randomUUID();
  const secret = createSupabaseSecretClient();
  const items = await listRecentSourceItems(ctx.tenantId, BATCH_ITEM_LIMIT);
  if (items.length === 0) return ok({ agentRunId, kind: "risk_detection" });
  const { context, tokenToItem } = buildContext(items);

  let result;
  try {
    result = await invoke(ctx, "risk_signal", "risk_detection", context);
  } catch (cause) {
    return err(
      new AppError(
        "internal",
        cause instanceof Error ? cause.message : "risk_detection_failed",
      ),
    );
  }
  if (!result.ok) return result;
  const parsed = RisksSchema.safeParse(result.value.output);
  if (!parsed.success) return ok({ agentRunId, kind: "risk_detection" });

  // Trust contract: a risk the model cannot attribute to a REAL retrieved item
  // is dropped, not written unattributed into the risk register (2026-07-20).
  const { attributed, dropped } = partitionAttributedExtractions(
    parsed.data.risks,
    tokenToItem,
  );
  const rows = attributed.map(({ item: r, sourceItemId }) => ({
    tenant_id: ctx.tenantId,
    title: clamp(r.title, 200),
    description: clamp(r.description, 2000),
    category: clamp(r.category, 60) || "operational",
    severity: VALID_SEVERITY.has(r.severity) ? r.severity : "medium",
    likelihood: VALID_LIKELIHOOD.has(r.likelihood) ? r.likelihood : "possible",
    status: "active",
    source_item_id: sourceItemId,
    prompt_version_id: result.value.promptVersionDbId,
  }));
  // Same trust-contract integrity guard as the decision path: audit the
  // survivor count only after the write succeeds, so a silent insert failure
  // can neither inflate the grounding-coverage summary nor lose risks unnoticed.
  if (rows.length > 0) {
    const { error } = await secret.from("risks").insert(rows);
    if (error) {
      return err(
        new AppError("internal", error.message ?? "risk_persist_failed"),
      );
    }
  }

  await auditService.record(ctx, {
    action: "pipeline.risk_detection.run",
    target: ctx.tenantId,
    metadata: { extracted: rows.length, droppedUnattributed: dropped },
  });
  return ok({ agentRunId, kind: "risk_detection" });
}

/** Synthesise durable topics from the recent batch into `topics`. */
async function runTopicSynthesis(
  ctx: TenantContext,
): Promise<Result<AgentRunResult>> {
  const agentRunId = randomUUID();
  const secret = createSupabaseSecretClient();
  const items = await listRecentSourceItems(ctx.tenantId, BATCH_ITEM_LIMIT);
  if (items.length === 0) return ok({ agentRunId, kind: "topic_synthesis" });
  const { context } = buildContext(items);

  let result;
  try {
    result = await invoke(ctx, "reasoning", "memory_synthesis", context);
  } catch {
    return ok({ agentRunId, kind: "topic_synthesis" });
  }
  if (!result.ok) return ok({ agentRunId, kind: "topic_synthesis" });
  const parsed = ThemesSchema.safeParse(result.value.output);
  if (!parsed.success) return ok({ agentRunId, kind: "topic_synthesis" });

  const rows = parsed.data.themes
    .map((t) => clamp(t.label, 80))
    .filter(Boolean)
    .map((name) => ({ tenant_id: ctx.tenantId, name }));
  // Check the write before auditing `topics: rows.length`: a fire-and-forget
  // upsert would record synthesised topics that never landed, so return loud on
  // a persist failure rather than logging a count the DB does not back.
  if (rows.length > 0) {
    const { error } = await secret
      .from("topics")
      .upsert(rows, { onConflict: "tenant_id,name", ignoreDuplicates: true });
    if (error) {
      return err(
        new AppError("internal", error.message ?? "topic_persist_failed"),
      );
    }
  }

  await auditService.record(ctx, {
    action: "pipeline.topic_synthesis.run",
    target: ctx.tenantId,
    metadata: { topics: rows.length },
  });
  return ok({ agentRunId, kind: "topic_synthesis" });
}

/** Rank the recent batch by consequence; update signals' priority_score/tier. */
async function runSignalRanking(
  ctx: TenantContext,
): Promise<Result<AgentRunResult>> {
  const agentRunId = randomUUID();
  const secret = createSupabaseSecretClient();
  const items = await listRecentSourceItems(ctx.tenantId, BATCH_ITEM_LIMIT);
  if (items.length === 0) return ok({ agentRunId, kind: "signal_ranking" });
  const { context, tokenToItem } = buildContext(items);

  let result;
  try {
    result = await invoke(ctx, "priority_scoring", "signal_ranking", context);
  } catch {
    return ok({ agentRunId, kind: "signal_ranking" });
  }
  if (!result.ok) return ok({ agentRunId, kind: "signal_ranking" });
  const parsed = RankingSchema.safeParse(result.value.output);
  if (!parsed.success) return ok({ agentRunId, kind: "signal_ranking" });

  let ranked = 0;
  let failedWrites = 0;
  for (const r of parsed.data.ranked) {
    const item = tokenToItem.get(r.itemId.trim());
    if (!item) continue;
    const tier = VALID_TIER.has(r.tier) ? r.tier : "background";
    // Only updates rows that already have a signal (classification ran first).
    // A swallowed error here previously looked identical to "no matching signal
    // yet" (both leave `ranked` unincremented); surface it under `failedWrites`
    // so a persistent update failure is observable rather than silent.
    const { data, error } = await secret
      .from("signals")
      .update({ priority_score: r.priorityScore, priority_tier: tier })
      .eq("tenant_id", ctx.tenantId)
      .eq("source_item_id", item.id)
      .select("id");
    if (error) {
      failedWrites += 1;
      continue;
    }
    if (data && data.length > 0) ranked += 1;
  }

  await auditService.record(ctx, {
    action: "pipeline.ranking.run",
    target: ctx.tenantId,
    metadata: { ranked, failedWrites },
  });
  return ok({ agentRunId, kind: "signal_ranking" });
}

/** Triage the recent batch into themed groups; persist to `signal_groups`. */
async function runSignalTriage(
  ctx: TenantContext,
): Promise<Result<AgentRunResult>> {
  const agentRunId = randomUUID();
  const secret = createSupabaseSecretClient();
  const items = await listRecentSourceItems(ctx.tenantId, BATCH_ITEM_LIMIT);
  if (items.length === 0) return ok({ agentRunId, kind: "signal_triage" });
  const { context, tokenToItem } = buildContext(items);

  let result;
  try {
    result = await invoke(ctx, "summarisation", "signal_triage", context);
  } catch {
    return ok({ agentRunId, kind: "signal_triage" });
  }
  if (!result.ok) return ok({ agentRunId, kind: "signal_triage" });
  const parsed = TriageSchema.safeParse(result.value.output);
  if (!parsed.success) return ok({ agentRunId, kind: "signal_triage" });

  const rows = parsed.data.groups.map((g) => {
    const itemIds = g.itemIds
      .map((t) => tokenToItem.get(t.trim())?.id)
      .filter((id): id is string => Boolean(id));
    return {
      tenant_id: ctx.tenantId,
      theme: clamp(g.theme, 200),
      item_ids: itemIds,
      recommended_action: VALID_RECOMMENDED_ACTION.has(g.recommendedAction)
        ? g.recommendedAction
        : "ignore",
      urgency: VALID_GROUP_URGENCY.has(g.urgency) ? g.urgency : "none",
      draft_note: clamp(g.draftNote, 1000),
      prompt_version_id: result.value.promptVersionDbId,
    };
  });
  // Audit `groups: rows.length` only once the insert lands — a fire-and-forget
  // write would report themed groups the operator's triage view never received.
  if (rows.length > 0) {
    const { error } = await secret.from("signal_groups").insert(rows);
    if (error) {
      return err(
        new AppError("internal", error.message ?? "signal_triage_persist_failed"),
      );
    }
  }

  await auditService.record(ctx, {
    action: "pipeline.triage.run",
    target: ctx.tenantId,
    metadata: { groups: rows.length },
  });
  return ok({ agentRunId, kind: "signal_triage" });
}

/**
 * People & relationship memory: extract per-person commitments/concerns/context
 * from the recent batch and append a note to MATCHING existing people (by name).
 * Unmatched names are skipped — we never invent or auto-create people.
 */
async function runPeopleMemory(
  ctx: TenantContext,
): Promise<Result<AgentRunResult>> {
  const agentRunId = randomUUID();
  const secret = createSupabaseSecretClient();
  const items = await listRecentSourceItems(ctx.tenantId, BATCH_ITEM_LIMIT);
  if (items.length === 0) return ok({ agentRunId, kind: "people_memory" });
  const { context } = buildContext(items);

  let result;
  try {
    result = await invoke(ctx, "extraction", "people_memory", context);
  } catch {
    return ok({ agentRunId, kind: "people_memory" });
  }
  if (!result.ok) return ok({ agentRunId, kind: "people_memory" });
  const parsed = PeopleSchema.safeParse(result.value.output);
  if (!parsed.success) return ok({ agentRunId, kind: "people_memory" });

  // Match names against existing people (case-insensitive), tenant-scoped.
  // Fail loud if this read errors: a swallowed error yields an empty name map,
  // so every extracted person silently fails to match, `noted` stays 0, and the
  // run is audited as a clean pass over `people.length` — losing the whole run's
  // relationship memory with no signal. This is the read-side complement of the
  // write-side people-memory hardening (decision-log 2026-08-03, follow-up #2).
  const { data: peopleRows, error: peopleErr } = await secret
    .from("people")
    .select("id, display_name")
    .eq("tenant_id", ctx.tenantId);
  if (peopleErr) {
    return err(new AppError("internal", peopleErr.message ?? "people_read_failed"));
  }
  const byName = new Map<string, string>();
  for (const p of peopleRows ?? []) {
    byName.set((p.display_name as string).trim().toLowerCase(), p.id as string);
  }

  let noted = 0;
  let failedWrites = 0;
  for (const person of parsed.data.people) {
    const personId = byName.get(person.name.trim().toLowerCase());
    if (!personId) continue;
    const lines = [
      ...person.commitments.map((c) => `Commitment: ${c}`),
      ...person.concerns.map((c) => `Concern: ${c}`),
      person.context ? `Context: ${person.context}` : "",
    ].filter(Boolean);
    if (lines.length === 0) continue;
    // Count only notes that actually persist: a fire-and-forget insert would
    // report the person as `noted` even when the write failed, silently losing
    // the relationship memory. One failed insert never aborts the batch; it is
    // tallied under `failedWrites` so a persistent failure stays observable.
    const { error } = await secret.from("person_notes").insert({
      tenant_id: ctx.tenantId,
      person_id: personId,
      body: clamp(lines.join("\n"), 1500),
    });
    if (error) {
      failedWrites += 1;
      continue;
    }
    noted += 1;
  }

  await auditService.record(ctx, {
    action: "pipeline.people_memory.run",
    target: ctx.tenantId,
    metadata: { noted, people: parsed.data.people.length, failedWrites },
  });
  return ok({ agentRunId, kind: "people_memory" });
}

/**
 * Diary reflection: read a single author's recent diary entries and persist a
 * private weekly reflection to diary_weekly_summaries. Author-scoped — it only
 * ever reads and writes for `authorUserId`.
 */
async function runDiaryReflection(
  ctx: TenantContext,
  authorUserId: string,
): Promise<Result<AgentRunResult>> {
  const agentRunId = randomUUID();
  if (!authorUserId) return ok({ agentRunId, kind: "diary_reflection" });
  const secret = createSupabaseSecretClient();

  // Fail loud if the entries read errors: a swallowed error is indistinguishable
  // from "this author has no diary entries", so a transient failure silently
  // skips the private weekly reflection and returns a clean run. The write side
  // of this function already fails loud (decision-log 2026-08-03); this closes
  // the read-side complement (follow-up #2).
  const { data: entries, error: entriesErr } = await secret
    .from("diary_entries")
    .select("id, body, transcript, entry_type, created_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("author_user_id", authorUserId)
    .order("created_at", { ascending: false })
    .limit(BATCH_ITEM_LIMIT);
  if (entriesErr) {
    return err(new AppError("internal", entriesErr.message ?? "diary_entries_read_failed"));
  }
  if (!entries || entries.length === 0) {
    return ok({ agentRunId, kind: "diary_reflection" });
  }

  const context: RetrievalContextItem[] = entries.map((e, index) => ({
    sourceItemId: `item-${index + 1}`,
    summary: clamp(
      `(${e.entry_type ?? "note"}) ${(e.body as string) || (e.transcript as string) || ""}`,
      800,
    ),
    occurredAt: e.created_at as string,
  }));

  let result;
  try {
    result = await invoke(ctx, "reasoning", "diary_reflection", context);
  } catch {
    return ok({ agentRunId, kind: "diary_reflection" });
  }
  if (!result.ok) return ok({ agentRunId, kind: "diary_reflection" });
  const parsed = DiarySchema.safeParse(result.value.output);
  if (!parsed.success) return ok({ agentRunId, kind: "diary_reflection" });
  const d = parsed.data;

  // Fail loud if the private weekly reflection does not persist: a swallowed
  // error would drop the operator's reflection while the audit still logged a
  // completed run over `entries.length` entries.
  const { error: reflectionError } = await secret
    .from("diary_weekly_summaries")
    .upsert(
      {
        tenant_id: ctx.tenantId,
        author_user_id: authorUserId,
        week_start_date: weekStartDate(),
        key_reflections: d.reflection ? [d.reflection] : [],
        important_decisions: d.decisions,
        notable_risks: d.risks,
        recurring_themes: d.recurringThemes,
        next_week_attention: d.nextWeekAttention,
        follow_ups_created: [],
        entry_count: entries.length,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,author_user_id,week_start_date" },
    );
  if (reflectionError) {
    return err(
      new AppError(
        "internal",
        reflectionError.message ?? "diary_reflection_persist_failed",
      ),
    );
  }

  await auditService.record(ctx, {
    action: "pipeline.diary_reflection.run",
    target: authorUserId,
    metadata: { entries: entries.length },
  });
  return ok({ agentRunId, kind: "diary_reflection" });
}

/**
 * Weekly operating review: roll the week's signals, decisions, risks, and
 * actions into an honest operating picture, persisted to operating_reviews.
 */
async function runWeeklyOperatingReview(
  ctx: TenantContext,
): Promise<Result<AgentRunResult>> {
  const agentRunId = randomUUID();
  const secret = createSupabaseSecretClient();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [signalsRes, decisionsRes, risksRes, actionsRes] = await Promise.all([
    secret
      .from("signals")
      .select("category, rationale, priority_tier")
      .eq("tenant_id", ctx.tenantId)
      .gte("classified_at", since)
      .limit(40),
    secret
      .from("decisions")
      .select("title, status")
      .eq("tenant_id", ctx.tenantId)
      .gte("created_at", since)
      .limit(40),
    secret
      .from("risks")
      .select("title, severity, status")
      .eq("tenant_id", ctx.tenantId)
      .gte("created_at", since)
      .limit(40),
    secret
      .from("suggested_actions")
      .select("title, status")
      .eq("tenant_id", ctx.tenantId)
      .gte("created_at", since)
      .limit(40),
  ]);

  // Fail loud on any feeder read. Swallowing here has two silent failure modes:
  // if all four reads error, `lines` is empty and the run returns as "nothing to
  // review"; if a subset error, the operating review is built over a partial
  // picture (e.g. a dropped `risks` read silently omits open risks) and audited
  // as complete over `considered: lines.length` — a weekly review the operator
  // trusts as whole while it misrepresents the week. Read-side complement of the
  // operating-review write hardening (decision-log 2026-08-03, follow-up #2).
  if (signalsRes.error)
    return err(new AppError("internal", signalsRes.error.message ?? "signals_read_failed"));
  if (decisionsRes.error)
    return err(new AppError("internal", decisionsRes.error.message ?? "decisions_read_failed"));
  if (risksRes.error)
    return err(new AppError("internal", risksRes.error.message ?? "risks_read_failed"));
  if (actionsRes.error)
    return err(new AppError("internal", actionsRes.error.message ?? "actions_read_failed"));

  const lines: string[] = [];
  for (const s of signalsRes.data ?? [])
    lines.push(
      `Signal [${s.category}/${s.priority_tier ?? "—"}]: ${s.rationale ?? ""}`,
    );
  for (const d of decisionsRes.data ?? [])
    lines.push(`Decision [${d.status}]: ${d.title}`);
  for (const r of risksRes.data ?? [])
    lines.push(`Risk [${r.severity}/${r.status}]: ${r.title}`);
  for (const a of actionsRes.data ?? [])
    lines.push(`Action [${a.status}]: ${a.title}`);

  if (lines.length === 0) {
    return ok({ agentRunId, kind: "weekly_operating_review" });
  }

  const context: RetrievalContextItem[] = lines
    .slice(0, 60)
    .map((line, index) => ({
      sourceItemId: `item-${index + 1}`,
      summary: clamp(line, 400),
      occurredAt: new Date().toISOString(),
    }));

  let result;
  try {
    result = await invoke(ctx, "reasoning", "weekly_operating_review", context);
  } catch {
    return ok({ agentRunId, kind: "weekly_operating_review" });
  }
  if (!result.ok) return ok({ agentRunId, kind: "weekly_operating_review" });
  const parsed = ReviewSchema.safeParse(result.value.output);
  if (!parsed.success)
    return ok({ agentRunId, kind: "weekly_operating_review" });
  const rv = parsed.data;

  // Fail loud on a persist failure so the run is not audited as complete while
  // the operating review the summary describes never reached the tenant.
  const { error: reviewError } = await secret.from("operating_reviews").upsert(
    {
      tenant_id: ctx.tenantId,
      week_start_date: weekStartDate(),
      summary: clamp(rv.summary, 2000),
      moved: rv.moved,
      stalled: rv.stalled,
      decisions: rv.decisions,
      open_risks: rv.openRisks,
      next_focus: rv.nextFocus,
      prompt_version_id: result.value.promptVersionDbId,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,week_start_date" },
  );
  if (reviewError) {
    return err(
      new AppError(
        "internal",
        reviewError.message ?? "operating_review_persist_failed",
      ),
    );
  }

  await auditService.record(ctx, {
    action: "pipeline.weekly_operating_review.run",
    target: ctx.tenantId,
    metadata: { considered: lines.length },
  });
  return ok({ agentRunId, kind: "weekly_operating_review" });
}

/**
 * Run the full intelligence batch over a tenant's recent items: classify, rank,
 * triage, extract actions/decisions/risks, build people memory, and synthesise
 * topics. Each step is best-effort — one failing never blocks the others or the
 * briefing that follows. Returns a single result; per-step counts are audited.
 */
async function runIntelligenceBatch(
  ctx: TenantContext,
): Promise<Result<AgentRunResult>> {
  const agentRunId = randomUUID();
  await runSignalClassification(ctx);
  await runSignalRanking(ctx);
  await runSignalTriage(ctx);
  await runActionExtraction(ctx);
  await runDecisionExtraction(ctx);
  await runRiskDetection(ctx);
  await runPeopleMemory(ctx);
  await runTopicSynthesis(ctx);
  await auditService.record(ctx, {
    action: "pipeline.intelligence_batch.run",
    target: ctx.tenantId,
    metadata: {},
  });
  return ok({ agentRunId, kind: "intelligence_batch" });
}

export const agentOrchestrationService: AgentOrchestrationService = {
  async run(ctx, req) {
    switch (req.kind) {
      case "daily_memo":
        return runDailyMemo(ctx);
      case "signal_classification":
        return runSignalClassification(ctx);
      case "signal_ranking":
        return runSignalRanking(ctx);
      case "signal_triage":
        return runSignalTriage(ctx);
      case "action_extraction":
        return runActionExtraction(ctx);
      case "decision_extraction":
        return runDecisionExtraction(ctx);
      case "risk_detection":
        return runRiskDetection(ctx);
      case "people_memory":
        return runPeopleMemory(ctx);
      case "topic_synthesis":
        return runTopicSynthesis(ctx);
      case "diary_reflection":
        return runDiaryReflection(
          ctx,
          (req.input?.userId as string | undefined) ?? ctx.userId,
        );
      case "weekly_operating_review":
        return runWeeklyOperatingReview(ctx);
      case "intelligence_batch":
        return runIntelligenceBatch(ctx);
      default:
        return err(
          new NotImplementedError(`agent-orchestration.run:${req.kind}`),
        );
    }
  },
};
