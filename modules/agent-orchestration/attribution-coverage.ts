import "server-only";

/**
 * modules/agent-orchestration/attribution-coverage — makes the memo/extraction
 * trust contract MEASURABLE.
 *
 * The Daily Memo and its sibling extraction agents (suggested actions,
 * decisions, risks) all enforce one rule: an AI-produced insight that cannot be
 * tied to a REAL retrieved source item is withheld, not shown
 * (`memo-attribution.ts`; governance decision log 2026-07-20). Each run already
 * records how many outputs it kept and how many it withheld in its
 * `audit_events` metadata (`droppedSections` / `droppedActions` /
 * `droppedUnattributed`). Until now nothing READ those counts back — the
 * trust contract worked silently and invisibly.
 *
 * This module rolls those recorded counts into a tenant-scoped "grounding"
 * summary over a trailing window: how many AI-suggested items Pilot kept
 * because they were grounded in the operator's sources, and how many it withheld
 * because they were not. It is the read/observability half of the 2026-07-20
 * ADR follow-up "surface the drop-rate as a quality signal" — the same shape as
 * `model-usage-cost.summarize` (which surfaced recorded spend on 2026-07-15).
 *
 * Privacy: reads only counts from audit metadata — never prompt/response
 * content. Tenant-scoped via the authenticated (RLS-enforced) client plus an
 * explicit tenant predicate as defence in depth.
 *
 * The aggregation itself (`summarizeAttributionCoverage`) is pure and lives here
 * so it is unit-testable without a database.
 */

import {
  AppError,
  err,
  ok,
  type Result,
  type TenantContext,
} from "@/modules/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The audit actions whose metadata carries kept/withheld attribution counts.
 * Used both to filter the query and to map each row to its agent bucket.
 */
export const COVERAGE_ACTIONS = [
  "briefing.generated",
  "pipeline.action_extraction.run",
  "pipeline.decision_extraction.run",
  "pipeline.risk_detection.run",
] as const;

/** Human, plain-language label for each agent bucket (no internal jargon). */
const AGENT_LABEL: Record<(typeof COVERAGE_ACTIONS)[number], string> = {
  "briefing.generated": "Briefing",
  "pipeline.action_extraction.run": "Suggested actions",
  "pipeline.decision_extraction.run": "Decisions",
  "pipeline.risk_detection.run": "Risks",
};

/** A single audit row consumed by the aggregation (metadata is opaque jsonb). */
export interface CoverageRow {
  readonly action: string | null;
  readonly metadata: Record<string, unknown> | null;
}

/** Per-agent grounding roll-up within the window. */
export interface AgentCoverage {
  /** Plain-language agent name (e.g. "Briefing", "Decisions"). */
  readonly agent: string;
  /** AI-produced items shown because they were grounded in a real source. */
  readonly kept: number;
  /** AI-produced items withheld because they could not be grounded. */
  readonly withheld: number;
}

/**
 * Tenant-scoped grounding summary over a trailing window. Carries counts only,
 * never content; safe to surface to the operator as evidence the trust contract
 * is actively protecting them.
 */
export interface AttributionCoverageSummary {
  readonly windowDays: number;
  /** ISO-8601 lower bound of the window (inclusive). */
  readonly since: string;
  /** Total AI-produced items kept (grounded) across all agents. */
  readonly kept: number;
  /** Total AI-produced items withheld (ungrounded) across all agents. */
  readonly withheld: number;
  /**
   * kept / (kept + withheld), rounded to 3dp. Defined as 1 when nothing was
   * produced (nothing withheld ⇒ perfect grounding, no false alarm).
   */
  readonly coverageRate: number;
  /** Per-agent breakdown, agents with activity only, most-withheld first. */
  readonly byAgent: readonly AgentCoverage[];
  /** True when the row cap was hit, so figures are a lower bound. */
  readonly truncated: boolean;
}

/** Coerce an opaque metadata value to a finite, non-negative count. */
function toCount(value: unknown): number {
  const n = typeof value === "string" ? Number.parseFloat(value) : (value as number);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Extract (kept, withheld) from one audit row's metadata, using the exact
 * shape each agent records:
 *  - `briefing.generated`: kept = shown model sections (total `sections` minus
 *    the one appended external-signals section, if any) + kept `actions`;
 *    withheld = `droppedSections` + `droppedActions`.
 *  - `pipeline.*_extraction.run` / `risk_detection.run`: kept = `extracted`
 *    (the survivors), withheld = `droppedUnattributed`.
 * Unknown/absent fields coerce to 0, so a metadata-shape change degrades to an
 * undercount rather than a crash.
 */
function rowCoverage(row: CoverageRow): { kept: number; withheld: number } {
  const m = row.metadata ?? {};
  if (row.action === "briefing.generated") {
    const sections = toCount(m.sections);
    const newsSection = toCount(m.externalSignals) > 0 ? 1 : 0;
    const kept = Math.max(0, sections - newsSection) + toCount(m.actions);
    const withheld = toCount(m.droppedSections) + toCount(m.droppedActions);
    return { kept, withheld };
  }
  // The three extraction pipelines share one shape.
  return { kept: toCount(m.extracted), withheld: toCount(m.droppedUnattributed) };
}

/**
 * Pure aggregation of audit rows into a {@link AttributionCoverageSummary}.
 * Extracted from the DB read so it is unit-testable without a database.
 */
export function summarizeAttributionCoverage(
  rows: readonly CoverageRow[],
  meta: { readonly windowDays: number; readonly since: string; readonly truncated: boolean },
): AttributionCoverageSummary {
  let kept = 0;
  let withheld = 0;
  const byAgent = new Map<string, { kept: number; withheld: number }>();

  for (const row of rows) {
    const label =
      AGENT_LABEL[row.action as (typeof COVERAGE_ACTIONS)[number]] ?? null;
    if (!label) continue;
    const c = rowCoverage(row);
    kept += c.kept;
    withheld += c.withheld;
    const bucket = byAgent.get(label) ?? { kept: 0, withheld: 0 };
    bucket.kept += c.kept;
    bucket.withheld += c.withheld;
    byAgent.set(label, bucket);
  }

  const total = kept + withheld;
  const coverageRate = total === 0 ? 1 : Math.round((kept / total) * 1000) / 1000;

  return {
    windowDays: meta.windowDays,
    since: meta.since,
    kept,
    withheld,
    coverageRate,
    byAgent: [...byAgent.entries()]
      .map(([agent, b]) => ({ agent, kept: b.kept, withheld: b.withheld }))
      .filter((a) => a.kept > 0 || a.withheld > 0)
      .sort((a, b) => b.withheld - a.withheld || b.kept - a.kept),
    truncated: meta.truncated,
  };
}

/** Hard cap on audit rows pulled for a single summary (PostgREST page size). */
export const COVERAGE_SUMMARY_ROW_CAP = 1000;

/**
 * Tenant-scoped read of grounding coverage over a trailing window. Reads only
 * counts from audit metadata (no content), through the authenticated
 * (RLS-enforced) client with an explicit tenant predicate as defence in depth.
 */
export interface AttributionCoverageService {
  summarize(
    ctx: TenantContext,
    opts?: { readonly windowDays?: number },
  ): Promise<Result<AttributionCoverageSummary>>;
}

export const attributionCoverageService: AttributionCoverageService = {
  async summarize(ctx, opts) {
    const windowDays = Math.max(1, Math.floor(opts?.windowDays ?? 30));
    const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("audit_events")
      .select("action, metadata")
      .eq("tenant_id", ctx.tenantId)
      .in("action", [...COVERAGE_ACTIONS])
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(COVERAGE_SUMMARY_ROW_CAP);
    if (error) {
      return err(new AppError("internal", error.message));
    }
    const rows = (data ?? []) as CoverageRow[];
    return ok(
      summarizeAttributionCoverage(rows, {
        windowDays,
        since,
        truncated: rows.length >= COVERAGE_SUMMARY_ROW_CAP,
      }),
    );
  },
};
