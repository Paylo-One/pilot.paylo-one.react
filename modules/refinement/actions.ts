"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import type { FeedbackType, UserFeedbackEvent } from "./refinement.types";

const FEEDBACK_TYPES = new Set<FeedbackType>([
  "not_relevant", "relevant", "always_include", "link_person", "wrong_person",
  "lower_priority", "raise_priority", "treat_as_action",
  "do_not_show_again", "link_topic", "confirm",
]);
const TARGET_TYPES = new Set<UserFeedbackEvent["targetType"]>([
  "source_item", "action", "person", "memo_section", "chat",
]);

export interface FeedbackInput {
  readonly eventId: string;
  readonly feedbackType: FeedbackType;
  readonly targetType: UserFeedbackEvent["targetType"];
  readonly targetId: string;
}

export type FeedbackResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidInput(input: unknown): input is FeedbackInput {
  if (!input || typeof input !== "object") return false;
  const candidate = input as Partial<Record<keyof FeedbackInput, unknown>>;
  return typeof candidate.eventId === "string"
    && typeof candidate.feedbackType === "string"
    && typeof candidate.targetType === "string"
    && typeof candidate.targetId === "string"
    && UUID_PATTERN.test(candidate.eventId)
    && FEEDBACK_TYPES.has(candidate.feedbackType as FeedbackType)
    && TARGET_TYPES.has(candidate.targetType as UserFeedbackEvent["targetType"])
    && candidate.targetId.trim().length > 0
    && candidate.targetId.length <= 200;
}

/** Persist one explicit operator correction without applying hidden learning. */
export async function submitFeedbackAction(input: unknown): Promise<FeedbackResult> {
  if (!isValidInput(input)) {
    return { ok: false, error: "This feedback request is invalid." };
  }

  const ctx = await requireTenantContext();
  try {
    const supabase = await createSupabaseServerClient();
    const payload = {
      id: input.eventId,
      tenant_id: ctx.tenantId,
      user_id: ctx.userId,
      feedback_type: input.feedbackType,
      target_type: input.targetType,
      target_id: input.targetId,
    };

    const { error } = await supabase.from("user_feedback_events").insert(payload);
    if (!error) return { ok: true };

    // A response can be lost after commit. Reconcile a replay against the
    // authoritative row rather than creating another event or trusting its id.
    if (error.code === "23505") {
      const { data: existing, error: readError } = await supabase
        .from("user_feedback_events")
        .select("tenant_id, user_id, feedback_type, target_type, target_id")
        .eq("id", input.eventId)
        .eq("tenant_id", ctx.tenantId)
        .maybeSingle();

      if (!readError
        && existing?.user_id === ctx.userId
        && existing.feedback_type === input.feedbackType
        && existing.target_type === input.targetType
        && existing.target_id === input.targetId) {
        return { ok: true };
      }
    }
  } catch {
    // The UI receives the same retryable contract for transport/client errors.
  }

  return { ok: false, error: "Pilot could not save that feedback. Please try again." };
}
