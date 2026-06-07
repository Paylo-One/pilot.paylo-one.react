"use server";

/**
 * Server Action: generate the Daily Memo on demand.
 *
 * Tenant context is re-derived server-side via requireTenantContext (never
 * trusted from the client). The action drives agent orchestration, which calls
 * the governed Model Gateway and persists a source-referenced briefing.
 */

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { agentOrchestrationService } from "@/modules/agent-orchestration";

export interface GenerateMemoResponse {
  readonly ok: boolean;
  readonly error?: string;
}

export async function generateDailyMemo(): Promise<GenerateMemoResponse> {
  const ctx = await requireTenantContext();

  const result = await agentOrchestrationService.run(ctx, { kind: "daily_memo" });
  if (!result.ok) {
    return { ok: false, error: result.error.message };
  }

  revalidatePath("/briefing");
  revalidatePath("/actions");
  return { ok: true };
}
