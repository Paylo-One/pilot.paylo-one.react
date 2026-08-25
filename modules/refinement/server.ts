import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/modules/shared";
import type { FeedbackType, UserFeedbackEvent } from "./refinement.types";

/**
 * Return visible targets whose latest relevance event matches `feedbackType`.
 * Corrections stay append-only: `relevant` supersedes `not_relevant` by event
 * time without deleting the operator's history.
 */
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
