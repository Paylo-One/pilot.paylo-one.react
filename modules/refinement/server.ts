import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/modules/shared";
import type { FeedbackType, UserFeedbackEvent } from "./refinement.types";

export interface SavedFeedbackView {
  readonly id: string;
  readonly feedbackType: string;
  readonly targetType: UserFeedbackEvent["targetType"];
  readonly targetId: string;
  readonly targetLabel: string | null;
  readonly createdAt: string;
}

const RECENT_FEEDBACK_LIMIT = 20;

/**
 * Return this operator's most recent saved corrections, with memo-section
 * context where it still exists. The event remains useful when its target has
 * since been removed, so missing target context is represented as `null`.
 */
export async function listRecentSavedFeedback(
  ctx: TenantContext,
): Promise<readonly SavedFeedbackView[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("user_feedback_events")
    .select("id, feedback_type, target_type, target_id, created_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(RECENT_FEEDBACK_LIMIT);

  if (error) throw new Error(`Failed to load recent feedback: ${error.message}`);

  const events = data ?? [];
  const memoSectionIds = events
    .filter((event) => event.target_type === "memo_section")
    .map((event) => event.target_id as string);
  const labelsById = new Map<string, string>();

  if (memoSectionIds.length > 0) {
    const { data: sections, error: sectionsError } = await supabase
      .from("briefing_sections")
      .select("id, kind, title")
      .eq("tenant_id", ctx.tenantId)
      .in("id", [...new Set(memoSectionIds)]);

    if (sectionsError) {
      throw new Error(`Failed to load feedback context: ${sectionsError.message}`);
    }
    for (const section of sections ?? []) {
      const kind = String(section.kind).replace(/_/g, " ");
      labelsById.set(section.id as string, (section.title as string | null)?.trim() || kind);
    }
  }

  return events.map((event) => ({
    id: event.id as string,
    feedbackType: event.feedback_type as string,
    targetType: event.target_type as UserFeedbackEvent["targetType"],
    targetId: event.target_id as string,
    targetLabel: labelsById.get(event.target_id as string) ?? null,
    createdAt: event.created_at as string,
  }));
}

/** Return visible targets for which this operator already saved this feedback. */
export async function listSavedFeedbackTargets(
  ctx: TenantContext,
  targetType: UserFeedbackEvent["targetType"],
  feedbackType: FeedbackType,
  targetIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const uniqueTargetIds = [...new Set(targetIds.filter(Boolean))];
  if (uniqueTargetIds.length === 0) return new Set();

  const supabase = await createSupabaseServerClient();
  const correctionType = feedbackType === "not_relevant" ? "relevant" : null;
  const query = supabase
    .from("user_feedback_events")
    .select("id, target_id, feedback_type, created_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.userId)
    .eq("target_type", targetType)
    .in("target_id", uniqueTargetIds);

  const { data, error } = correctionType
    ? await query.in("feedback_type", [feedbackType, correctionType])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
    : await query.eq("feedback_type", feedbackType);

  if (error) throw new Error(`Failed to load saved feedback: ${error.message}`);
  if (!correctionType) return new Set((data ?? []).map((row) => row.target_id as string));

  const current = new Set<string>();
  const seen = new Set<string>();
  for (const row of data ?? []) {
    const targetId = row.target_id as string;
    if (seen.has(targetId)) continue;
    seen.add(targetId);
    if (row.feedback_type === feedbackType) current.add(targetId);
  }
  return current;
}
