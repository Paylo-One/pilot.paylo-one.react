"use server";

/**
 * Server Actions for the operator's decision on a suggested action:
 * approve / defer / dismiss. Per product/actions.md these are STATUS CHANGES
 * only — Paylo.one never sends, posts, or schedules anything on the operator's
 * behalf.
 *
 * The update runs on the USER server client (RLS permits authenticated UPDATE
 * on suggested_actions, scoped to the tenant). Tenant context is re-derived
 * server-side; the tenant_id predicate is added as defence-in-depth. Every
 * decision is recorded as a business audit event.
 */

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { auditService } from "@/modules/audit";

export type ActionDecision = "approve" | "defer" | "dismiss";

const DECISION_TO_STATUS: Record<ActionDecision, "approved" | "deferred" | "dismissed"> = {
  approve: "approved",
  defer: "deferred",
  dismiss: "dismissed",
};

export interface DecideActionResponse {
  readonly ok: boolean;
  readonly error?: string;
}

export async function decideAction(
  actionId: string,
  decision: ActionDecision,
): Promise<DecideActionResponse> {
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
  return { ok: true };
}
