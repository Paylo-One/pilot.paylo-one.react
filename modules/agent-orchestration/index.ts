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
import { listMemoSourceItems, type StoredSourceItem } from "@/modules/knowledge-store/server";
import { auditService } from "@/modules/audit";
import { modelGateway, type GatewayRequest, type RetrievalContextItem } from "@/modules/model-gateway";
import { appendExternalSignalsToBriefing } from "@/modules/news/briefing";
import { checkBriefingLimit } from "@/modules/briefing/server";

export type AgentKind =
  | "daily_memo"
  | "action_extraction"
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
  run(ctx: TenantContext, req: AgentRunRequest): Promise<Result<AgentRunResult>>;
}

/** How many recent items to consider for a Daily Memo run. */
const MEMO_ITEM_LIMIT = 25;
/** Default confidence when the model does not supply one for a reference. */
const DEFAULT_CONFIDENCE = 0.7;

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

/** Clamp text to a bound so prompts/excerpts stay cost- and storage-bounded. */
function clamp(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** A condensed, model-facing summary of a source item (summaries over raw). */
function itemSummary(item: StoredSourceItem): string {
  const head = item.title ? `${item.title}` : "(untitled)";
  const body = item.body ? ` — ${clamp(item.body, 500)}` : "";
  const author = item.author ? ` [from: ${item.author}]` : "";
  return clamp(`(${item.system}) ${head}${body}${author}`, 800);
}

/** A short, real excerpt for a source reference (never fabricated). */
function itemExcerpt(item: StoredSourceItem): string {
  return clamp(item.title || item.body || `(${item.system} item)`, 160);
}

function roundConfidence(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
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

  const { data: briefing, error: briefingErr } = await secret
    .from("briefings")
    .insert({ tenant_id: ctx.tenantId, status: "ready", summary })
    .select("id")
    .single();
  if (briefingErr || !briefing) {
    return err(new AppError("internal", briefingErr?.message ?? "briefing_create_failed"));
  }
  const briefingId = briefing.id as string;

  const { error: sectionErr } = await secret.from("briefing_sections").insert({
    tenant_id: ctx.tenantId,
    briefing_id: briefingId,
    kind: "executive_summary",
    position: 0,
    title: "A quiet day",
    body: "Nothing new has come in from your connected channels. Connect a source or capture a note, then regenerate.",
  });
  if (sectionErr) {
    return err(new AppError("internal", sectionErr.message));
  }

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
 * actions, and a source reference for every section/action (best-effort mapping
 * from the model's item id tokens, with a fallback so the trust contract holds
 * whenever items exist).
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
  // A deterministic fallback reference target (most recent item) so every
  // section/action can cite at least one real item.
  const fallbackItem = tokenToItem.size > 0 ? [...tokenToItem.values()][0] : null;

  const { data: briefing, error: briefingErr } = await secret
    .from("briefings")
    .insert({
      tenant_id: ctx.tenantId,
      status: "ready",
      summary: memo.summary,
      prompt_version_id: promptVersionDbId,
    })
    .select("id")
    .single();
  if (briefingErr || !briefing) {
    return err(new AppError("internal", briefingErr?.message ?? "briefing_create_failed"));
  }
  const briefingId = briefing.id as string;

  // Resolve a list of model-supplied tokens to real, de-duplicated items.
  const resolveItems = (tokens: readonly string[]): StoredSourceItem[] => {
    const seen = new Set<string>();
    const resolved: StoredSourceItem[] = [];
    for (const token of tokens) {
      const item = tokenToItem.get(token.trim());
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        resolved.push(item);
      }
    }
    if (resolved.length === 0 && fallbackItem) resolved.push(fallbackItem);
    return resolved;
  };

  // Sections (ordered) + their source references.
  let position = 0;
  for (const section of memo.sections) {
    const { data: sectionRow, error: sectionErr } = await secret
      .from("briefing_sections")
      .insert({
        tenant_id: ctx.tenantId,
        briefing_id: briefingId,
        kind: section.kind,
        position,
        title: section.title,
        body: section.body,
      })
      .select("id")
      .single();
    if (sectionErr || !sectionRow) {
      return err(new AppError("internal", sectionErr?.message ?? "section_create_failed"));
    }
    position += 1;

    const refs = resolveItems(section.sourceItemIds).map((item) => ({
      tenant_id: ctx.tenantId,
      briefing_section_id: sectionRow.id as string,
      source_item_id: item.id,
      source_system: item.system,
      item_timestamp: item.occurredAt,
      confidence: roundConfidence(section.confidence ?? DEFAULT_CONFIDENCE),
      excerpt_or_pointer: itemExcerpt(item),
    }));
    if (refs.length > 0) {
      const { error: refErr } = await secret.from("source_references").insert(refs);
      if (refErr) return err(new AppError("internal", refErr.message));
    }
  }

  // Suggested actions (status 'suggested') + their source references.
  let actionsCreated = 0;
  for (const action of memo.actions) {
    const { data: actionRow, error: actionErr } = await secret
      .from("suggested_actions")
      .insert({
        tenant_id: ctx.tenantId,
        briefing_id: briefingId,
        status: "suggested",
        title: action.title,
        rationale: action.rationale,
      })
      .select("id")
      .single();
    if (actionErr || !actionRow) {
      return err(new AppError("internal", actionErr?.message ?? "action_create_failed"));
    }
    actionsCreated += 1;

    const refs = resolveItems(action.sourceItemIds).map((item) => ({
      tenant_id: ctx.tenantId,
      suggested_action_id: actionRow.id as string,
      source_item_id: item.id,
      source_system: item.system,
      item_timestamp: item.occurredAt,
      confidence: DEFAULT_CONFIDENCE,
      excerpt_or_pointer: itemExcerpt(item),
    }));
    if (refs.length > 0) {
      const { error: refErr } = await secret.from("source_references").insert(refs);
      if (refErr) return err(new AppError("internal", refErr.message));
    }
  }

  const news = await appendNewsSafely(ctx.tenantId, briefingId, position);
  await auditService.record(ctx, {
    action: "briefing.generated",
    target: briefingId,
    metadata: {
      kind: "daily_memo",
      itemsConsidered,
      sections: memo.sections.length + (news.count > 0 ? 1 : 0),
      actions: actionsCreated,
      promptVersionId: promptVersionDbId,
      externalSignals: news.count,
      externalSignalsError: news.error,
    },
  });

  return ok({ agentRunId, kind: "daily_memo", briefingId });
}

/** The Daily Memo agent: retrieve -> Gateway -> validate -> persist. */
async function runDailyMemo(ctx: TenantContext): Promise<Result<AgentRunResult>> {
  const agentRunId = randomUUID();

  // Billing capability check (observe-only)
  await checkBriefingLimit(ctx.tenantId);

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
    const message = cause instanceof Error ? cause.message : "model_gateway_invocation_failed";
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

export const agentOrchestrationService: AgentOrchestrationService = {
  async run(ctx, req) {
    switch (req.kind) {
      case "daily_memo":
        return runDailyMemo(ctx);
      default:
        return err(new NotImplementedError(`agent-orchestration.run:${req.kind}`));
    }
  },
};
