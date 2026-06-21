/**
 * Intelligence · History — the consolidated audit trail across prompts, skills,
 * and the manifesto. Read-only; RLS scopes every row to the tenant.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AuditTimeline, type AuditEntry } from "./audit-timeline";

export default async function IntelligenceAuditPage() {
  await requireTenantContext();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("audit_events")
    .select("id, action, metadata, occurred_at")
    .or(
      "action.like.prompt.%,action.like.custom_skill.%,action.like.manifesto.%",
    )
    .order("occurred_at", { ascending: false })
    .limit(80);

  const entries: AuditEntry[] = (data ?? []).map((e) => ({
    id: e.id as string,
    action: e.action as string,
    occurredAt: e.occurred_at as string,
    metadata: (e.metadata ?? null) as Record<string, unknown> | null,
  }));

  return <AuditTimeline entries={entries} />;
}
