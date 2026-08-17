import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/modules/shared";
import type { FeedbackType, UserFeedbackEvent } from "./refinement.types";

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
  const { data, error } = await supabase
    .from("user_feedback_events")
    .select("target_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.userId)
    .eq("target_type", targetType)
    .eq("feedback_type", feedbackType)
    .in("target_id", uniqueTargetIds);

  if (error) throw new Error(`Failed to load saved feedback: ${error.message}`);
  return new Set((data ?? []).map((row) => row.target_id as string));
}
