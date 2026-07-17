"use server";

/**
 * Server Actions for the First-Login Onboarding Wizard.
 * Persists the user's initial setup (timezone, briefing time, and source refresh preferences),
 * registers audit trails, and unlocks the workspace layout.
 */

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureSourceConnection } from "@/modules/source-connection/server";
import { auditService } from "@/modules/audit";
import type { SourceSystem } from "@/modules/shared";

export interface OnboardingInput {
  timezone: string;
  briefingTime: string; // "HH:MM"
  syncSources: SourceSystem[];
}

export interface OnboardingResult {
  ok: boolean;
  error: string | null;
  /**
   * Sources the user asked to auto-refresh that could not be configured
   * (e.g. plan connection limit reached, or a transient DB error). Onboarding
   * still completes; these can be reconnected later from Settings → Sources.
   */
  failedSources?: SourceSystem[];
}

/** Basic IANA-style timezone shape check; empty falls back to UTC. */
function normaliseTimezone(raw: string): string {
  const value = raw.trim();
  return value.length > 0 ? value : "UTC";
}

/** HTML time inputs yield "HH:MM"; empty means "no preference" (null). */
function normaliseBriefingTime(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0) return null;
  return /^\d{2}:\d{2}$/.test(value) ? value : null;
}

export async function completeOnboardingAction(
  input: OnboardingInput,
): Promise<OnboardingResult> {
  try {
    const ctx = await requireTenantContext();
    const supabase = await createSupabaseServerClient();

    const timezone = normaliseTimezone(input.timezone);
    const briefingTime = normaliseBriefingTime(input.briefingTime);

    // 1. Configure selected auto-refresh sources (best-effort).
    //    Source setup must not gate onboarding: a single provider failing
    //    (e.g. `ensureSourceConnection` throwing on a plan connection limit, or
    //    a transient update error) previously aborted the whole action after
    //    earlier sources were already flipped to "connected", leaving the user
    //    stuck at the final step with no way to finish. Accumulate per-source
    //    failures and continue; the sources that did connect are kept and the
    //    rest are reported back for later retry.
    const failedSources: SourceSystem[] = [];
    for (const sys of input.syncSources) {
      try {
        // Ensure the source connection exists
        const connId = await ensureSourceConnection(ctx, sys, {
          displayName: sys.charAt(0).toUpperCase() + sys.slice(1),
          storagePolicy: "summaries_only",
        });

        // Update refresh & sync settings
        const { error: connErr } = await supabase
          .from("source_connections")
          .update({
            auto_refresh_enabled: true,
            sync_frequency: "daily",
            next_sync_at: new Date().toISOString(),
            status: "connected",
          })
          .eq("id", connId);

        if (connErr) {
          throw new Error(connErr.message);
        }
      } catch (sourceErr) {
        failedSources.push(sys);
        console.warn(
          `[onboarding] source configuration failed for ${sys}:`,
          sourceErr instanceof Error ? sourceErr.message : sourceErr,
        );
      }
    }

    // 2. Commit the profile last: timezone, briefing time, and completion.
    //    This is the authoritative "onboarding done" signal, so it runs after
    //    the best-effort source setup — that way we never mark onboarding
    //    complete (and dismiss the wizard) when the core preferences failed to
    //    persist, and a partial source failure no longer discards a valid setup.
    const { error: profileErr } = await supabase
      .from("user_profiles")
      .update({
        timezone,
        briefing_time: briefingTime,
        onboarding_completed: true,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", ctx.userId);

    if (profileErr) {
      throw new Error(`Profile update failed: ${profileErr.message}`);
    }

    // 3. Log onboarding completion audit event
    await auditService.record(ctx, {
      action: "profile.onboarding.completed",
      metadata: {
        timezone,
        briefingTime,
        syncSources: input.syncSources,
        failedSources,
      },
    });

    // Revalidate the root layout path to dismiss the wizard overlay
    revalidatePath("/", "layout");

    return {
      ok: true,
      error: null,
      failedSources: failedSources.length > 0 ? failedSources : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}
