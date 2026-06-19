import { notFound } from "next/navigation";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listPeopleDirectory } from "@/modules/people/people-server";
import { ActionDetailWorkspace } from "./action-detail-workspace";

export default async function ActionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenantContext();
  const supabase = await createSupabaseServerClient();

  // Fetch the action
  const { data: actionData, error: actionErr } = await supabase
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
      documents
    `)
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();

  if (actionErr || !actionData) {
    notFound();
  }

  // Fetch references
  const { data: refData } = await supabase
    .from("source_references")
    .select("id, suggested_action_id, source_system, item_timestamp, confidence, excerpt_or_pointer, diary_entry_id")
    .eq("suggested_action_id", id);

  const references = (refData ?? []).map((row) => ({
    id: row.id,
    sourceSystem: row.source_system,
    itemTimestamp: row.item_timestamp,
    confidence: row.confidence,
    excerptOrPointer: row.excerpt_or_pointer,
    diaryEntryId: row.diary_entry_id,
  }));

  const action = {
    id: actionData.id,
    status: actionData.status,
    title: actionData.title,
    rationale: actionData.rationale,
    dueAt: actionData.due_at,
    personId: actionData.person_id,
    createdAt: actionData.created_at,
    description: actionData.description,
    followUpAt: actionData.follow_up_at,
    priority: actionData.priority,
    completedAt: actionData.completed_at,
    snoozedUntil: actionData.snoozed_until,
    createdBy: actionData.created_by,
    createdFrom: actionData.created_from,
    topics: actionData.topics ?? [],
    snoozeMetadata: actionData.snooze_metadata,
    completionMetadata: actionData.completion_metadata,
    documents: actionData.documents ?? [],
    references,
  };

  // Fetch all people
  const people = await listPeopleDirectory();

  // Fetch all existing unique topics to provide autocomplete context
  const { data: allActionsTopics } = await supabase
    .from("suggested_actions")
    .select("topics")
    .eq("tenant_id", ctx.tenantId);

  const existingTopicsSet = new Set<string>();
  if (allActionsTopics) {
    for (const r of allActionsTopics) {
      if (r.topics) {
        for (const t of r.topics) {
          if (t && t.trim()) {
            existingTopicsSet.add(t.trim());
          }
        }
      }
    }
  }

  return (
    <main className="workspace__content action-detail-page">
      <ActionDetailWorkspace
        action={action}
        tenantId={ctx.tenantId}
        people={people.map((p) => ({
          id: p.id,
          displayName: p.displayName,
          roleTitle: p.roleTitle,
          organisation: p.organisation,
          status: p.status,
        }))}
        existingTopics={Array.from(existingTopicsSet)}
      />
    </main>
  );
}
