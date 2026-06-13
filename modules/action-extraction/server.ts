import "server-only";

/**
 * modules/action-extraction/server.ts
 *
 * Server-only read helper for the Actions queue. Reads run through the USER
 * server client (RLS enforces tenant isolation) with an explicit tenant_id
 * predicate as defence-in-depth.
 *
 * Status transitions (approve/defer/dismiss) are NOT here — they are Server
 * Actions co-located with the Actions page. RLS permits authenticated UPDATE on
 * suggested_actions, so those run on the user client (no secret client needed).
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ActionStatus = "suggested" | "approved" | "edited" | "deferred" | "dismissed";

export interface ActionSourceReference {
  readonly id: string;
  readonly sourceSystem: string;
  readonly itemTimestamp: string | null;
  readonly confidence: number | null;
  readonly excerptOrPointer: string | null;
}

export interface SuggestedActionView {
  readonly id: string;
  readonly status: ActionStatus;
  readonly title: string;
  readonly rationale: string | null;
  readonly dueAt: string | null;
  readonly personId: string | null;
  readonly createdAt: string;
  readonly references: ActionSourceReference[];
}

interface ActionRow {
  id: string;
  status: ActionStatus;
  title: string;
  rationale: string | null;
  due_at: string | null;
  person_id: string | null;
  created_at: string;
}

interface SourceReferenceRow {
  id: string;
  suggested_action_id: string | null;
  source_system: string;
  item_timestamp: string | null;
  confidence: number | null;
  excerpt_or_pointer: string | null;
}

/** All actions for the tenant (newest first), each with its source references. */
export async function listSuggestedActions(tenantId: string): Promise<SuggestedActionView[]> {
  const supabase = await createSupabaseServerClient();

  const { data: actionData } = await supabase
    .from("suggested_actions")
    .select("id, status, title, rationale, due_at, person_id, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  const actions = (actionData ?? []) as ActionRow[];
  if (actions.length === 0) return [];

  const actionIds = actions.map((a) => a.id);
  const referencesByAction = new Map<string, ActionSourceReference[]>();

  const { data: refData } = await supabase
    .from("source_references")
    .select("id, suggested_action_id, source_system, item_timestamp, confidence, excerpt_or_pointer")
    .in("suggested_action_id", actionIds);

  for (const row of (refData ?? []) as SourceReferenceRow[]) {
    if (!row.suggested_action_id) continue;
    const list = referencesByAction.get(row.suggested_action_id) ?? [];
    list.push({
      id: row.id,
      sourceSystem: row.source_system,
      itemTimestamp: row.item_timestamp,
      confidence: row.confidence,
      excerptOrPointer: row.excerpt_or_pointer,
    });
    referencesByAction.set(row.suggested_action_id, list);
  }

  return actions.map((a) => ({
    id: a.id,
    status: a.status,
    title: a.title,
    rationale: a.rationale,
    dueAt: a.due_at,
    personId: a.person_id,
    createdAt: a.created_at,
    references: referencesByAction.get(a.id) ?? [],
  }));
}
