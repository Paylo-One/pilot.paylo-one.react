import "server-only";

/**
 * modules/action-extraction/server.ts
 *
 * Server-only read helper for the Actions queue. Reads run through the USER
 * server client (RLS enforces tenant isolation) with an explicit tenant_id
 * predicate as defence-in-depth.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ActionStatus = "inbox" | "planned" | "in_progress" | "waiting" | "follow_up" | "completed" | "cancelled";
export type ActionPriority = "critical" | "high" | "normal" | "low";
export type ActionCreatedFrom = "manual" | "suggestion" | "diary" | "briefing" | "meeting" | "email" | "people";

export interface ActionSourceReference {
  readonly id: string;
  readonly sourceSystem: string;
  readonly itemTimestamp: string | null;
  readonly confidence: number | null;
  readonly excerptOrPointer: string | null;
  readonly diaryEntryId: string | null;
}

export interface SuggestedActionView {
  readonly id: string;
  readonly status: ActionStatus;
  readonly title: string;
  readonly rationale: string | null;
  readonly dueAt: string | null;
  readonly personId: string | null;
  readonly createdAt: string;
  readonly description: string | null;
  readonly followUpAt: string | null;
  readonly priority: ActionPriority;
  readonly completedAt: string | null;
  readonly snoozedUntil: string | null;
  readonly createdBy: string | null;
  readonly createdFrom: ActionCreatedFrom;
  readonly topics: string[];
  readonly snoozeMetadata: any;
  readonly completionMetadata: any;
  readonly documents: any[];
  readonly duplicateGroupId: string | null;
  readonly duplicateConfidence: number | null;
  readonly duplicateReason: string | null;
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
  description: string | null;
  follow_up_at: string | null;
  priority: ActionPriority;
  completed_at: string | null;
  snoozed_until: string | null;
  created_by: string | null;
  created_from: ActionCreatedFrom;
  topics: string[];
  snooze_metadata: any;
  completion_metadata: any;
  documents: any[];
  duplicate_group_id: string | null;
  duplicate_confidence: number | null;
  duplicate_reason: string | null;
}

interface SourceReferenceRow {
  id: string;
  suggested_action_id: string | null;
  source_system: string;
  item_timestamp: string | null;
  confidence: number | null;
  excerpt_or_pointer: string | null;
  diary_entry_id: string | null;
}

/** All actions for the tenant (newest first), each with its source references. */
export async function listSuggestedActions(tenantId: string): Promise<SuggestedActionView[]> {
  const supabase = await createSupabaseServerClient();

  const { data: actionData } = await supabase
    .from("suggested_actions")
    .select(`
      id, 
      status, 
      title, 
      rationale, 
      due_at, 
      person_id, 
      created_at,
      description,
      follow_up_at,
      priority,
      completed_at,
      snoozed_until,
      created_by,
      created_from,
      topics,
      snooze_metadata,
      completion_metadata,
      documents,
      duplicate_group_id,
      duplicate_confidence,
      duplicate_reason
    `)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  const actions = (actionData ?? []) as ActionRow[];
  if (actions.length === 0) return [];

  const actionIds = actions.map((a) => a.id);
  const referencesByAction = new Map<string, ActionSourceReference[]>();

  const { data: refData } = await supabase
    .from("source_references")
    .select("id, suggested_action_id, source_system, item_timestamp, confidence, excerpt_or_pointer, diary_entry_id")
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
      diaryEntryId: row.diary_entry_id,
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
    description: a.description,
    followUpAt: a.follow_up_at,
    priority: a.priority,
    completedAt: a.completed_at,
    snoozedUntil: a.snoozed_until,
    createdBy: a.created_by,
    createdFrom: a.created_from,
    topics: a.topics ?? [],
    snoozeMetadata: a.snooze_metadata,
    completionMetadata: a.completion_metadata,
    documents: a.documents ?? [],
    duplicateGroupId: a.duplicate_group_id,
    duplicateConfidence: a.duplicate_confidence != null ? Number(a.duplicate_confidence) : null,
    duplicateReason: a.duplicate_reason,
    references: referencesByAction.get(a.id) ?? [],
  }));
}
