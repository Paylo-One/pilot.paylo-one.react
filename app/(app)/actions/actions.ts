"use server";

/**
 * Server Actions for the Actions surface.
 * Scoped fully to the authenticated tenant via requireTenantContext.
 * Writes audit logs for tracing all mutations.
 */

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { auditService } from "@/modules/audit";
import { ActionStatus, ActionPriority, ActionCreatedFrom } from "@/modules/action-extraction/server";
import { createLlmClient, llmChatModel, hasLlm } from "@/lib/llm";
import { actionOrigin, type ActionOrigin } from "./action-origin";

export interface ActionDocument {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly type: string;
  readonly size: number;
  readonly uploadedAt: string;
  readonly uploadedBy: string;
}

export type ActionDecision = "approve" | "defer" | "dismiss";

const DECISION_TO_STATUS: Record<ActionDecision, ActionStatus> = {
  approve: "planned",
  defer: "follow_up",
  dismiss: "cancelled",
};

export interface ActionResponse {
  readonly ok: boolean;
  readonly error?: string;
  readonly data?: any;
}

export async function createAction(input: {
  title: string;
  description?: string;
  priority?: ActionPriority;
  status?: ActionStatus;
  dueAt?: string | null;
  followUpAt?: string | null;
  topics?: string[];
  personId?: string | null;
  rationale?: string | null;
  createdFrom: ActionOrigin;
  briefingSectionId?: string | null;
  handoffKey?: string | null;
}): Promise<ActionResponse> {
  try {
    if (!input.title || !input.title.trim()) {
      return { ok: false, error: "Action title is required." };
    }

    const ctx = await requireTenantContext();
    const supabase = await createSupabaseServerClient();

    // Get the current user ID
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return { ok: false, error: "Authenticated user context not found." };
    }

    const origin = actionOrigin(input.createdFrom);
    if (origin === "briefing" && (!input.briefingSectionId || !input.handoffKey)) {
      return { ok: false, error: "Daily briefing source context is required." };
    }
    const payload = {
        tenant_id: ctx.tenantId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        status: input.status || "inbox",
        priority: input.priority || "normal",
        due_at: input.dueAt || null,
        follow_up_at: input.followUpAt || null,
        topics: input.topics || [],
        person_id: input.personId || null,
        rationale: input.rationale?.trim() || null,
        created_by: user.id,
        created_from: origin as ActionCreatedFrom,
      };

    const groundedBriefingHandoff = origin === "briefing";
    const { data, error } = groundedBriefingHandoff
      ? await supabase.rpc("create_action_from_briefing_section", {
          p_tenant_id: ctx.tenantId,
          p_section_id: input.briefingSectionId,
          p_handoff_key: input.handoffKey,
          p_action: payload,
        })
      : await supabase.from("suggested_actions").insert(payload).select().single();

    if (error) {
      return { ok: false, error: error.message };
    }

    await auditService.record(ctx, {
      action: "action.create",
      target: data.id,
      metadata: {
        title: input.title,
        priority: input.priority,
        status: input.status,
        createdFrom: origin,
        sourceReferencesPreserved: groundedBriefingHandoff,
      },
    });

    revalidatePath("/actions");
    revalidatePath("/briefing");
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message || "An unexpected error occurred." };
  }
}

export async function updateAction(
  actionId: string,
  input: {
    title?: string;
    description?: string | null;
    priority?: ActionPriority;
    status?: ActionStatus;
    dueAt?: string | null;
    followUpAt?: string | null;
    topics?: string[];
    personId?: string | null;
    rationale?: string | null;
  },
): Promise<ActionResponse> {
  try {
    if (!actionId) {
      return { ok: false, error: "Action ID is required." };
    }

    const ctx = await requireTenantContext();
    const supabase = await createSupabaseServerClient();

    const updatePayload: Record<string, any> = {};
    if (input.title !== undefined) updatePayload.title = input.title.trim();
    if (input.description !== undefined) updatePayload.description = input.description?.trim() || null;
    if (input.priority !== undefined) updatePayload.priority = input.priority;
    if (input.status !== undefined) {
      updatePayload.status = input.status;
      // Automatically set completed_at when status is 'completed'
      if (input.status === "completed") {
        updatePayload.completed_at = new Date().toISOString();
      } else {
        updatePayload.completed_at = null;
      }
    }
    if (input.dueAt !== undefined) updatePayload.due_at = input.dueAt || null;
    if (input.followUpAt !== undefined) updatePayload.follow_up_at = input.followUpAt || null;
    if (input.topics !== undefined) updatePayload.topics = input.topics;
    if (input.personId !== undefined) updatePayload.person_id = input.personId || null;
    if (input.rationale !== undefined) updatePayload.rationale = input.rationale?.trim() || null;

    const { data, error } = await supabase
      .from("suggested_actions")
      .update(updatePayload)
      .eq("id", actionId)
      .eq("tenant_id", ctx.tenantId)
      .select()
      .maybeSingle();

    if (error) {
      return { ok: false, error: error.message };
    }
    if (!data) {
      return { ok: false, error: "Action not found in this workspace." };
    }

    await auditService.record(ctx, {
      action: "action.update",
      target: actionId,
      metadata: input,
    });

    revalidatePath("/actions");
    revalidatePath("/briefing");
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message || "An unexpected error occurred." };
  }
}

export async function snoozeAction(
  actionId: string,
  snoozedUntil: string | null,
  reason?: string,
): Promise<ActionResponse> {
  try {
    if (!actionId) {
      return { ok: false, error: "Action ID is required." };
    }

    const ctx = await requireTenantContext();
    const supabase = await createSupabaseServerClient();

    // Fetch existing action to read current snooze metadata
    const { data: existing, error: fetchErr } = await supabase
      .from("suggested_actions")
      .select("snooze_metadata, status")
      .eq("id", actionId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    if (fetchErr) return { ok: false, error: fetchErr.message };
    if (!existing) return { ok: false, error: "Action not found." };

    const snoozeHistory = existing.snooze_metadata?.history || [];
    const newHistoryEntry = {
      snoozed_at: new Date().toISOString(),
      snoozed_until: snoozedUntil,
      reason: reason || "No reason provided",
    };

    const updatePayload: Record<string, any> = {
      snoozed_until: snoozedUntil || null,
      snooze_metadata: {
        history: [...snoozeHistory, newHistoryEntry],
        last_snooze: newHistoryEntry,
      },
    };

    // If snoozing, ensure the item is planned/rescheduled, but don't force status change unless inbox
    if (snoozedUntil && existing.status === "inbox") {
      updatePayload.status = "planned";
    }

    const { data, error } = await supabase
      .from("suggested_actions")
      .update(updatePayload)
      .eq("id", actionId)
      .eq("tenant_id", ctx.tenantId)
      .select()
      .maybeSingle();

    if (error) return { ok: false, error: error.message };

    await auditService.record(ctx, {
      action: "action.snooze",
      target: actionId,
      metadata: { snoozedUntil, reason },
    });

    revalidatePath("/actions");
    revalidatePath("/briefing");
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message || "An unexpected error occurred." };
  }
}

export async function completeAction(
  actionId: string,
  feedback?: string,
): Promise<ActionResponse> {
  try {
    if (!actionId) {
      return { ok: false, error: "Action ID is required." };
    }

    const ctx = await requireTenantContext();
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase
      .from("suggested_actions")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completion_metadata: {
          feedback: feedback || null,
          completed_by_user_at: new Date().toISOString(),
        },
      })
      .eq("id", actionId)
      .eq("tenant_id", ctx.tenantId)
      .select()
      .maybeSingle();

    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "Action not found." };

    await auditService.record(ctx, {
      action: "action.complete",
      target: actionId,
      metadata: { feedback },
    });

    revalidatePath("/actions");
    revalidatePath("/briefing");
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message || "An unexpected error occurred." };
  }
}

export async function deleteAction(actionId: string): Promise<ActionResponse> {
  try {
    if (!actionId) {
      return { ok: false, error: "Action ID is required." };
    }

    const ctx = await requireTenantContext();
    const supabase = await createSupabaseServerClient();

    const { error } = await supabase
      .from("suggested_actions")
      .delete()
      .eq("id", actionId)
      .eq("tenant_id", ctx.tenantId);

    if (error) return { ok: false, error: error.message };

    await auditService.record(ctx, {
      action: "action.delete",
      target: actionId,
    });

    revalidatePath("/actions");
    revalidatePath("/briefing");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "An unexpected error occurred." };
  }
}

export async function linkActionPerson(
  actionId: string,
  personId: string | null,
): Promise<ActionResponse> {
  if (!actionId) {
    return { ok: false, error: "Action ID is required." };
  }

  const ctx = await requireTenantContext();
  const supabase = await createSupabaseServerClient();

  if (personId) {
    const { data: person, error: personError } = await supabase
      .from("people")
      .select("id")
      .eq("id", personId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    if (personError) {
      return { ok: false, error: personError.message };
    }
    if (!person) {
      return { ok: false, error: "Person not found in this workspace." };
    }
  }

  const { data, error } = await supabase
    .from("suggested_actions")
    .update({ person_id: personId })
    .eq("id", actionId)
    .eq("tenant_id", ctx.tenantId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data) {
    return { ok: false, error: "Action not found." };
  }

  await auditService.record(ctx, {
    action: personId ? "action.person.linked" : "action.person.unlinked",
    target: actionId,
    metadata: { personId },
  });

  revalidatePath("/actions");
  return { ok: true };
}

export async function decideAction(
  actionId: string,
  decision: ActionDecision,
): Promise<ActionResponse> {
  const status = DECISION_TO_STATUS[decision];
  if (!status) {
    return { ok: false, error: "Unknown decision." };
  }

  const ctx = await requireTenantContext();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("suggested_actions")
    .update({ status })
    .eq("id", actionId)
    .eq("tenant_id", ctx.tenantId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data) {
    return { ok: false, error: "Action not found." };
  }

  await auditService.record(ctx, {
    action: `action.${decision}`,
    target: actionId,
    metadata: { status },
  });

  revalidatePath("/actions");
  revalidatePath("/briefing");
  return { ok: true };
}

/**
 * Clear the review queue: every inbox suggestion is dismissed in one step.
 * Dismissed (not completed) keeps the record honest — nothing the operator
 * never approved is recorded as done work — while the items still land in the
 * board's Done column, labelled Dismissed.
 */
export async function clearReviewQueue(): Promise<ActionResponse> {
  try {
    const ctx = await requireTenantContext();
    const supabase = await createSupabaseServerClient();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("suggested_actions")
      .update({
        status: "cancelled",
        completed_at: now,
        cleanup_metadata: {
          cleanup_type: "review_queue_cleared",
          cleared_at: now,
        },
      })
      .eq("tenant_id", ctx.tenantId)
      .eq("status", "inbox")
      .select("id");

    if (error) return { ok: false, error: error.message };
    const clearedIds = (data ?? []).map((row) => row.id);

    await auditService.record(ctx, {
      action: "action.review_queue.cleared",
      target: ctx.tenantId,
      metadata: { cleared: clearedIds.length, actionIds: clearedIds },
    });

    revalidatePath("/actions");
    revalidatePath("/briefing");
    return { ok: true, data: { cleared: clearedIds.length } };
  } catch (err: any) {
    return { ok: false, error: err.message || "An unexpected error occurred." };
  }
}

export async function mergeDuplicateActions(input: {
  primaryActionId: string;
  duplicateActionIds: string[];
  approvePrimary?: boolean;
  reason?: string;
}): Promise<ActionResponse> {
  try {
    const duplicateIds = Array.from(new Set(input.duplicateActionIds)).filter(
      (id) => id && id !== input.primaryActionId,
    );
    if (!input.primaryActionId || duplicateIds.length === 0) {
      return { ok: false, error: "Choose at least two actions to merge." };
    }

    const ctx = await requireTenantContext();
    const supabase = await createSupabaseServerClient();
    const now = new Date().toISOString();

    const { data: primary, error: primaryError } = await supabase
      .from("suggested_actions")
      .select("id, title, status")
      .eq("id", input.primaryActionId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    if (primaryError) return { ok: false, error: primaryError.message };
    if (!primary) return { ok: false, error: "Main action not found." };

    const { data: duplicates, error: duplicatesError } = await supabase
      .from("suggested_actions")
      .select("id, title, status")
      .eq("tenant_id", ctx.tenantId)
      .in("id", duplicateIds);

    if (duplicatesError) return { ok: false, error: duplicatesError.message };
    if (!duplicates || duplicates.length === 0) {
      return { ok: false, error: "Duplicate actions were not found." };
    }

    const { error: updateDuplicatesError } = await supabase
      .from("suggested_actions")
      .update({
        status: "cancelled",
        merged_into_action_id: input.primaryActionId,
        cleanup_metadata: {
          cleanup_type: "duplicate_merge",
          merged_into_action_id: input.primaryActionId,
          merged_at: now,
          reason: input.reason || "Merged from possible duplicate review.",
        },
        completion_metadata: {
          merged_into_action_id: input.primaryActionId,
          merged_at: now,
          reason: input.reason || "Merged from possible duplicate review.",
        },
      })
      .eq("tenant_id", ctx.tenantId)
      .in("id", duplicates.map((item) => item.id));

    if (updateDuplicatesError) return { ok: false, error: updateDuplicatesError.message };

    if (input.approvePrimary && primary.status === "inbox") {
      const { error: approveError } = await supabase
        .from("suggested_actions")
        .update({ status: "planned" })
        .eq("tenant_id", ctx.tenantId)
        .eq("id", input.primaryActionId);
      if (approveError) return { ok: false, error: approveError.message };
    }

    await auditService.record(ctx, {
      action: input.approvePrimary ? "action.duplicates.merge_and_approve" : "action.duplicates.merge",
      target: input.primaryActionId,
      metadata: {
        duplicateActionIds: duplicates.map((item) => item.id),
        duplicateTitles: duplicates.map((item) => item.title),
        primaryTitle: primary.title,
        reason: input.reason,
      },
    });

    revalidatePath("/actions");
    revalidatePath("/briefing");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "An unexpected error occurred." };
  }
}

export async function suggestActionMetadata(
  title: string,
  description?: string,
): Promise<{
  ok: boolean;
  error?: string;
  suggestions?: {
    topics: string[];
    people: { id: string; displayName: string }[];
    dueAt: string | null;
    followUpAt: string | null;
    priority: ActionPriority;
    waitingOnSomeone: boolean;
  };
}> {
  try {
    if (!title || !title.trim()) {
      return { ok: false, error: "Title is required for metadata suggestions." };
    }

    const ctx = await requireTenantContext();
    const supabase = await createSupabaseServerClient();

    // 1. Fetch distinct existing topics
    const { data: actionsData, error: actionsError } = await supabase
      .from("suggested_actions")
      .select("topics")
      .eq("tenant_id", ctx.tenantId);

    if (actionsError) {
      throw new Error(`Could not read action topics: ${actionsError.message}`);
    }

    const existingTopicsSet = new Set<string>();
    if (actionsData) {
      for (const row of actionsData) {
        if (row.topics) {
          for (const t of row.topics) {
            if (t && t.trim()) {
              existingTopicsSet.add(t.trim());
            }
          }
        }
      }
    }
    const existingTopics = Array.from(existingTopicsSet);

    // 2. Fetch directory people
    const { data: peopleData, error: peopleError } = await supabase
      .from("people")
      .select("id, display_name")
      .eq("tenant_id", ctx.tenantId);

    if (peopleError) {
      throw new Error(`Could not read people for action suggestions: ${peopleError.message}`);
    }
    
    const peopleList = (peopleData ?? []).map((p) => ({
      id: p.id,
      displayName: p.display_name,
    }));

    const combinedText = `${title} ${description || ""}`;

    // 3. Fallback heuristic parsing function
    const getFallback = () => {
      const lower = combinedText.toLowerCase();
      
      // Topics suggestion based on existing topics
      const topics = existingTopics.filter((topic) =>
        lower.includes(topic.toLowerCase())
      );

      // People suggestion based on exact display name match
      const people = peopleList.filter((person) =>
        lower.includes(person.displayName.toLowerCase())
      );

      // Priority determination
      let priority: ActionPriority = "normal";
      if (/\b(urgent|asap|critical|blocker|emergency|immediate|high-priority|milestone)\b/i.test(lower)) {
        priority = "high";
      } else if (/\b(low|whenever|backlog|trivial|idle|non-urgent|someday)\b/i.test(lower)) {
        priority = "low";
      }

      // Dates parsing
      let dueAt: string | null = null;
      let followUpAt: string | null = null;
      const today = new Date();

      if (/\b(today|eod)\b/i.test(lower)) {
        dueAt = today.toISOString().split("T")[0] || null;
      } else if (/\b(tomorrow)\b/i.test(lower)) {
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        dueAt = tomorrow.toISOString().split("T")[0] || null;
      } else if (/\b(next week|by next week)\b/i.test(lower)) {
        const nextWeek = new Date(today);
        nextWeek.setDate(today.getDate() + 7);
        dueAt = nextWeek.toISOString().split("T")[0] || null;
      }

      if (/\b(follow up|follow-up|check in|revisit|touch base|ping)\b/i.test(lower)) {
        const inThreeDays = new Date(today);
        inThreeDays.setDate(today.getDate() + 3);
        followUpAt = inThreeDays.toISOString().split("T")[0] || null;
      }

      const waitingOnSomeone = /\b(wait for|waiting on|waiting for|blocked by|depends on|ping)\b/i.test(lower);

      return {
        topics,
        people,
        dueAt,
        followUpAt,
        priority,
        waitingOnSomeone,
      };
    };

    // 4. Try the configured LLM provider (EU router or hosted OpenAI, ADR-045)
    if (!hasLlm()) {
      return { ok: true, suggestions: getFallback() };
    }

    try {
      const client = createLlmClient();
      const systemPrompt = `You are an assistant in Pilot by Paylo.one. Your task is to analyze an action's title and description to extract and suggest structured metadata.
We want to keep metadata minimal and avoid information hoarding and tag clutter. Suggest only what is highly relevant and high-value.

Context of this workspace:
- Existing topics in use: ${JSON.stringify(existingTopics)}
- Directory of people (id and name): ${JSON.stringify(peopleList)}

Please prioritize existing topics over creating new ones. Only suggest a topic if it matches closely or is highly relevant.
Only match people from the provided Directory of people. Map their names to their IDs. If none match, return an empty array for people.
Determine the priority ("critical", "high", "normal", "low") based on the language.
Determine if the action is waiting on someone else ("waitingOnSomeone": true/false).
Suggest "dueAt" (due date) or "followUpAt" (follow-up date) in "YYYY-MM-DD" format if mentioned or implied. (Assume today is ${new Date().toISOString().split('T')[0]}).

You must respond with a JSON object in this exact schema:
{
  "topics": string[], // suggested topics (prefer existing)
  "peopleIds": string[], // IDs of matched people from the Directory
  "dueAt": string | null, // YYYY-MM-DD
  "followUpAt": string | null, // YYYY-MM-DD
  "priority": "critical" | "high" | "normal" | "low",
  "waitingOnSomeone": boolean
}`;

      const response = await client.chat.completions.create({
        model: llmChatModel(),
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Action Title: "${title}"\nDescription: "${description || ""}"` },
        ],
      });

      const resText = response.choices[0]?.message?.content;
      if (!resText) {
        return { ok: true, suggestions: getFallback() };
      }

      const parsed = JSON.parse(resText);
      const suggestedPeople = peopleList.filter((p) =>
        (parsed.peopleIds || []).includes(p.id)
      );

      return {
        ok: true,
        suggestions: {
          topics: parsed.topics || [],
          people: suggestedPeople,
          dueAt: parsed.dueAt || null,
          followUpAt: parsed.followUpAt || null,
          priority: parsed.priority || "normal",
          waitingOnSomeone: !!parsed.waitingOnSomeone,
        },
      };
    } catch (llmErr) {
      console.warn("LLM metadata extraction failed, falling back to heuristics:", llmErr);
      return { ok: true, suggestions: getFallback() };
    }
  } catch (err: any) {
    return { ok: false, error: err.message || "An unexpected error occurred." };
  }
}

export async function registerActionDocument(
  actionId: string,
  doc: ActionDocument,
): Promise<ActionResponse> {
  try {
    if (!actionId) {
      return { ok: false, error: "Action ID is required." };
    }

    const ctx = await requireTenantContext();
    const supabase = await createSupabaseServerClient();

    // Fetch existing documents array
    const { data: existing, error: fetchErr } = await supabase
      .from("suggested_actions")
      .select("documents")
      .eq("id", actionId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    if (fetchErr) return { ok: false, error: fetchErr.message };
    if (!existing) return { ok: false, error: "Action not found." };

    const currentDocs = Array.isArray(existing.documents) ? existing.documents : [];
    const updatedDocs = [...currentDocs, doc];

    const { error: updateErr } = await supabase
      .from("suggested_actions")
      .update({ documents: updatedDocs })
      .eq("id", actionId)
      .eq("tenant_id", ctx.tenantId);

    if (updateErr) return { ok: false, error: updateErr.message };

    await auditService.record(ctx, {
      action: "action.document.uploaded",
      target: actionId,
      metadata: { documentId: doc.id, documentName: doc.name },
    });

    revalidatePath("/actions");
    revalidatePath(`/actions/${actionId}`);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "An unexpected error occurred." };
  }
}

export async function removeActionDocument(
  actionId: string,
  documentId: string,
): Promise<ActionResponse> {
  try {
    if (!actionId || !documentId) {
      return { ok: false, error: "Action ID and Document ID are required." };
    }

    const ctx = await requireTenantContext();
    const supabase = await createSupabaseServerClient();

    // Fetch existing documents array
    const { data: existing, error: fetchErr } = await supabase
      .from("suggested_actions")
      .select("documents")
      .eq("id", actionId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();

    if (fetchErr) return { ok: false, error: fetchErr.message };
    if (!existing) return { ok: false, error: "Action not found." };

    const currentDocs = Array.isArray(existing.documents) ? existing.documents : [];
    const docToRemove = currentDocs.find((d: any) => d.id === documentId);
    if (!docToRemove) {
      return { ok: false, error: "Document not found on this action." };
    }

    const updatedDocs = currentDocs.filter((d: any) => d.id !== documentId);

    const { error: updateErr } = await supabase
      .from("suggested_actions")
      .update({ documents: updatedDocs })
      .eq("id", actionId)
      .eq("tenant_id", ctx.tenantId);

    if (updateErr) return { ok: false, error: updateErr.message };

    // Delete the file from the storage bucket as well
    const { error: storageErr } = await supabase.storage
      .from("uploads")
      .remove([docToRemove.path]);

    if (storageErr) {
      console.warn("Could not delete from storage bucket:", storageErr.message);
    }

    await auditService.record(ctx, {
      action: "action.document.removed",
      target: actionId,
      metadata: { documentId, documentName: docToRemove.name },
    });

    revalidatePath("/actions");
    revalidatePath(`/actions/${actionId}`);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "An unexpected error occurred." };
  }
}
