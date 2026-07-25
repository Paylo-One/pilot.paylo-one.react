/**
 * Intelligence · History — the consolidated audit trail across prompts, skills,
 * and the manifesto, led by a calm summary of how well Pilot's AI output stays
 * grounded in the operator's own sources (kept vs held back). Read-only; RLS
 * scopes every row to the tenant.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { attributionCoverageService } from "@/modules/agent-orchestration/attribution-coverage";
import { AuditTimeline, type AuditEntry } from "./audit-timeline";
import { GroundingSummary } from "./grounding-summary";

export default async function IntelligenceAuditPage() {
  const ctx = await requireTenantContext();
  const supabase = await createSupabaseServerClient();

  const [{ data }, coverageRes] = await Promise.all([
    supabase
      .from("audit_events")
      .select("id, action, metadata, occurred_at")
      .or(
        "action.like.prompt.%,action.like.custom_skill.%,action.like.manifesto.%",
      )
      .order("occurred_at", { ascending: false })
      .limit(80),
    attributionCoverageService.summarize(ctx, { windowDays: 30 }),
  ]);

  const entries: AuditEntry[] = (data ?? []).map((e) => ({
    id: e.id as string,
    action: e.action as string,
    occurredAt: e.occurred_at as string,
    metadata: (e.metadata ?? null) as Record<string, unknown> | null,
  }));

  return (
    <div className="stack" style={{ gap: "var(--space-lg)" }}>
      {coverageRes.ok ? <GroundingSummary summary={coverageRes.value} /> : null}
      <AuditTimeline entries={entries} />
    </div>
  );
}
