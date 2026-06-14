"use server";

/**
 * Server Actions for the Actions Command Centre.
 * Scoped fully to the authenticated tenant via requireTenantContext.
 * Writes audit logs for tracing all mutations.
 */

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { auditService } from "@/modules/audit";
import { ActionStatus, ActionPriority, ActionCreatedFrom } from "@/modules/action-extraction/server";

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

    const { data, error } = await supabase
      .from("suggested_actions")
      .insert({
        tenant_id: ctx.tenantId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        status: input.status || "inbox",
        priority: input.priority || "normal",
        due_at: input.dueAt || null,
        follow_up_at: input.followUpAt || null,
        topics: input.topics || [],
        person_id: input.personId || null,
        created_by: user.id,
        created_from: "manual" as ActionCreatedFrom,
      })
      .select()
      .single();

    if (error) {
      return { ok: false, error: error.message };
    }

    await auditService.record(ctx, {
      action: "action.create",
      target: data.id,
      metadata: { title: input.title, priority: input.priority, status: input.status },
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
