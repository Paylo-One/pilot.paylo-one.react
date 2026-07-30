import { Inngest, eventType, staticSchema } from "inngest";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import type { TenantContext, TenantRole } from "@/modules/shared";
import { agentOrchestrationService } from "@/modules/agent-orchestration";
import { semanticLinkingService } from "@/modules/semantic-linking";
import { getIntegrationAccessToken } from "@/modules/source-connection/server";
import { syncActiveRepositories } from "@/modules/source-connection/github-repos";
import { syncActiveResources as syncActiveNotionResources } from "@/modules/source-connection/notion";
import {
  getValidGoogleToken,
  syncGmail,
  syncCalendar,
} from "@/modules/source-connection/google";
import {
  getValidMicrosoftToken,
  syncMs365Mail,
  syncTeams,
} from "@/modules/source-connection/microsoft";
import {
  getValidSlackToken,
  syncSlackChannels,
} from "@/modules/source-connection/slack";
import {
  getValidDiscordToken,
  syncDiscordChannels,
} from "@/modules/source-connection/discord";
import { syncActiveWhatsAppMonitors } from "@/modules/source-connection/whatsapp-sync";
import { runNewsIngestion } from "@/modules/news/ingest";
import {
  dailyBriefingDedupeKey,
  isBriefingDue,
  runDailyBriefingDelivery,
} from "@/modules/notification/briefing-email";
import { notificationService } from "@/modules/notification";
import { listEnabledNewsTenantIds } from "@/modules/news/server";
import { calculateNextSyncAt } from "@/lib/sync-schedule";

// 1. Initialize the Inngest client
export const inngest = new Inngest({
  id: "paylo-one-app",
});

// A completed source run must never depend indefinitely on a downstream
// function being registered correctly in Inngest Cloud. Give intelligence
// processing time to enrich the memo, then let the already-registered source
// handler recover the hand-off if no briefing was linked to the run.
export const BRIEFING_FALLBACK_DELAY = "10m";

// 2. Define the static event payload types (types must be aliases, not interfaces, as per v4 specs)
export type BriefingGeneratePayload = {
  tenantId: string;
  userId?: string;
  date?: string;
  /** Set when triggered by a completed sync cycle — used for idempotency and
   *  to record which cycle produced the memo (ADR-043). Absent for ad-hoc/manual
   *  triggers. */
  runId?: string;
};

export type NewsIngestPayload = {
  tenantId: string;
  dedupeKey: string;
  trigger: "scheduled" | "manual" | "internal" | "recovery";
};

export type SourceSyncPayload = {
  runId: string;
  tenantId: string;
  connectionId: string;
};

export type IntelligenceProcessPayload = {
  tenantId: string;
  /** The sync run that triggered processing, for provenance. */
  runId?: string;
};

export type OperatingReviewPayload = {
  tenantId: string;
};

export type DailyBriefingEmailPayload = {
  tenantId: string;
  /** `tenant:user:localDay` — the idempotency key for one briefing per local day. */
  dedupeKey: string;
};

// 3. Define the event types using eventType and staticSchema
export const briefingGenerateEvent = eventType("briefing/generate", {
  schema: staticSchema<BriefingGeneratePayload>(),
});

export const newsIngestEvent = eventType("news/ingest", {
  schema: staticSchema<NewsIngestPayload>(),
});

const NEWS_INGESTION_BUCKET_MS = 5 * 60 * 1000;

export function newsIngestionDedupeKey(
  tenantId: string,
  at = new Date(),
): string {
  return `${tenantId}:${Math.floor(at.getTime() / NEWS_INGESTION_BUCKET_MS)}`;
}

export async function enqueueNewsIngestions(
  tenantIds: readonly string[],
  trigger: NewsIngestPayload["trigger"],
): Promise<string[]> {
  if (tenantIds.length === 0) return [];
  const now = new Date();
  const response = await inngest.send(
    tenantIds.map((tenantId) => ({
      name: "news/ingest" as const,
      data: {
        tenantId,
        dedupeKey: newsIngestionDedupeKey(tenantId, now),
        trigger,
      },
    })),
  );
  return response.ids;
}

export const sourceSyncEvent = eventType("source/sync", {
  schema: staticSchema<SourceSyncPayload>(),
});

export const intelligenceProcessEvent = eventType("intelligence/process", {
  schema: staticSchema<IntelligenceProcessPayload>(),
});

export const operatingReviewEvent = eventType("operating/review", {
  schema: staticSchema<OperatingReviewPayload>(),
});

export const dailyBriefingEmailEvent = eventType("notification/daily-briefing", {
  schema: staticSchema<DailyBriefingEmailPayload>(),
});

/**
 * Resolve a background job's tenant context + scheduling preferences from the
 * tenant owner's profile. Jobs have no operator session, so we run the work as
 * the tenant owner (the wedge is single-operator-first). Timezone + preferred
 * briefing time drive next-sync computation and the memo schedule (ADR-043).
 */
async function resolveTenantJobContext(
  supabase: ReturnType<typeof createSupabaseSecretClient>,
  tenantId: string,
): Promise<{ ctx: TenantContext; timezone: string; briefingTime: string }> {
  const { data: tenant } = await supabase
    .from("tenants")
    .select("slug")
    .eq("id", tenantId)
    .maybeSingle();

  // Prefer the explicit owner; fall back to the earliest member.
  let owner: { user_id: string; role: string } | null = null;
  const { data: ownerRow } = await supabase
    .from("tenant_users")
    .select("user_id, role")
    .eq("tenant_id", tenantId)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();
  owner = ownerRow ?? null;
  if (!owner) {
    const { data: anyMember } = await supabase
      .from("tenant_users")
      .select("user_id, role")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    owner = anyMember ?? null;
  }

  let timezone = "UTC";
  let briefingTime = "08:00:00";
  if (owner?.user_id) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("timezone, briefing_time")
      .eq("user_id", owner.user_id)
      .maybeSingle();
    if (profile) {
      timezone = (profile.timezone as string | null) || "UTC";
      briefingTime = (profile.briefing_time as string | null) || "08:00:00";
    }
  }

  const ctx: TenantContext = {
    tenantId,
    tenantSlug: (tenant?.slug as string | undefined) ?? "",
    userId: owner?.user_id ?? "",
    role: (owner?.role as TenantRole | undefined) ?? "owner",
  };
  return { ctx, timezone, briefingTime };
}

/**
 * Run the real connector for a connection's system and return how many items it
 * ingested. Reuses the exact session-less helpers the manual sync actions use
 * (token retrieval + per-system connector). Throws on a hard failure so the
 * caller records the source as failed with the message. Manual sources
 * (file_upload / obsidian) and news have nothing to poll — treated as no-ops.
 */
async function runConnectorSync(
  system: string,
  tenantId: string,
  connectionId: string,
): Promise<number> {
  switch (system) {
    case "github": {
      const token = await getIntegrationAccessToken(tenantId, connectionId);
      if (!token) throw new Error("No GitHub credentials stored.");
      return (await syncActiveRepositories(tenantId, connectionId, token))
        .itemCount;
    }
    case "notion": {
      const token = await getIntegrationAccessToken(tenantId, connectionId);
      if (!token) throw new Error("No Notion credentials stored.");
      return (await syncActiveNotionResources(tenantId, connectionId, token))
        .itemCount;
    }
    case "email": {
      const token = await getValidGoogleToken(tenantId, connectionId);
      if (!token) throw new Error("No Google credentials stored.");
      return (await syncGmail(tenantId, connectionId, token)).itemCount;
    }
    case "calendar": {
      const token = await getValidGoogleToken(tenantId, connectionId);
      if (!token) throw new Error("No Google credentials stored.");
      return (await syncCalendar(tenantId, connectionId, token)).itemCount;
    }
    case "ms365_mail": {
      const token = await getValidMicrosoftToken(tenantId, connectionId);
      if (!token) throw new Error("No Microsoft 365 credentials stored.");
      return (await syncMs365Mail(tenantId, connectionId, token)).itemCount;
    }
    case "teams": {
      const token = await getValidMicrosoftToken(tenantId, connectionId);
      if (!token) throw new Error("No Microsoft 365 credentials stored.");
      return (await syncTeams(tenantId, connectionId, token)).itemCount;
    }
    case "slack": {
      const token = await getValidSlackToken(tenantId, connectionId);
      if (!token) throw new Error("No Slack credentials stored.");
      return (await syncSlackChannels(tenantId, connectionId, token)).itemCount;
    }
    case "discord": {
      const token = await getValidDiscordToken(tenantId, connectionId);
      if (!token) throw new Error("No Discord bot token configured.");
      return (await syncDiscordChannels(tenantId, connectionId, token))
        .itemCount;
    }
    case "whatsapp":
      return (await syncActiveWhatsAppMonitors(tenantId, connectionId))
        .itemCount;
    default:
      console.log(
        `[source/sync] system "${system}" has no automatic sync — skipping (tenant ${tenantId})`,
      );
      return 0;
  }
}

/**
 * Cron dispatcher (ADR-043). Every 15 minutes it atomically claims every due
 * source connection (one run per tenant) via start_scheduled_sync_runs() and
 * fans out a source/sync job per connection. The claim marks connections
 * 'syncing', so an in-flight connection is never re-dispatched (no duplicate
 * syncs); stale claims (>1h) are recovered. concurrency:1 prevents overlapping
 * ticks from racing the claim.
 */
export const schedulerDispatchFunction = inngest.createFunction(
  {
    id: "scheduler-dispatch",
    name: "Dispatch Due Source Syncs",
    concurrency: { limit: 1 },
    triggers: [{ cron: "*/15 * * * *" }],
  },
  async ({ step }) => {
    const supabase = createSupabaseSecretClient();

    const dispatches = await step.run("claim-due-connections", async () => {
      const { data, error } = await supabase.rpc("start_scheduled_sync_runs");
      if (error) {
        throw new Error(`Failed to claim due source syncs: ${error.message}`);
      }
      return (data ?? []) as Array<{
        run_id: string;
        tenant_id: string;
        connection_id: string;
      }>;
    });

    if (dispatches.length === 0) {
      return { dispatched: 0 };
    }

    await step.sendEvent(
      "fan-out-source-syncs",
      dispatches.map((d) => ({
        name: "source/sync" as const,
        data: {
          runId: d.run_id,
          tenantId: d.tenant_id,
          connectionId: d.connection_id,
        },
      })),
    );

    console.log(
      `[scheduler-dispatch] dispatched ${dispatches.length} source/sync job(s)`,
    );
    return { dispatched: dispatches.length };
  },
);

/**
 * Background handler for one source's scheduled sync (ADR-043). Triggered by
 * the "source/sync" event. Runs the real connector for the connection's system,
 * records success/failure on the connection (a failure never throws past here,
 * so sibling sources in the same run still complete), recomputes next_sync_at,
 * and atomically finalises the run — triggering briefing/generate exactly once
 * when the last source completes.
 */
export const sourceSyncFunction = inngest.createFunction(
  {
    id: "source-sync",
    name: "Synchronize Connected Source",
    triggers: [sourceSyncEvent],
  },
  async ({ event, step }) => {
    const { runId, tenantId, connectionId } = event.data;
    const supabase = createSupabaseSecretClient();

    // 1. Load the connection.
    const connection = await step.run("validate-connection", async () => {
      const { data, error } = await supabase
        .from("source_connections")
        .select("id, system, sync_frequency, failed_sync_attempts")
        .eq("id", connectionId)
        .single();
      if (error || !data) {
        throw new Error(`Source connection not found: ${connectionId}`);
      }
      return data as {
        id: string;
        system: string;
        sync_frequency: string;
        failed_sync_attempts: number | null;
      };
    });

    // 2. Run the real connector. The error is caught INSIDE the step and
    //    returned (never thrown), so a slow/flaky source fails fast and the run
    //    finalises immediately — instead of Inngest step-retrying for minutes
    //    and stalling the whole cycle's briefing. A failed source is simply
    //    retried on the next scheduled cycle.
    const syncOutcome = await step.run("perform-sync", async () => {
      console.log(
        `[source/sync] syncing ${connection.system} for tenant ${tenantId} (run ${runId})`,
      );
      try {
        const items = await runConnectorSync(
          connection.system,
          tenantId,
          connectionId,
        );
        return { ok: true, itemsFetched: items, error: null as string | null };
      } catch (err) {
        const error =
          err instanceof Error ? err.message : "Unknown error during sync";
        console.error(
          `[source/sync] sync failed for connection ${connectionId}:`,
          error,
        );
        return { ok: false, itemsFetched: 0, error };
      }
    });
    const syncSuccess = syncOutcome.ok;
    const syncError = syncOutcome.error;
    const itemsFetched = syncOutcome.itemsFetched;

    // 3. Recompute the next scheduled sync from the tenant owner's timezone.
    const nextSyncTimestamp = await step.run(
      "calculate-next-sync",
      async () => {
        const { timezone, briefingTime } = await resolveTenantJobContext(
          supabase,
          tenantId,
        );
        return calculateNextSyncAt(
          connection.sync_frequency,
          timezone,
          briefingTime,
        ).toISOString();
      },
    );

    // 4. Persist the connection's sync state (clear the claim).
    await step.run("update-connection-state", async () => {
      const update = {
        last_sync_status: syncSuccess ? "success" : "failed",
        last_sync_error: syncError,
        failed_sync_attempts: syncSuccess
          ? 0
          : (connection.failed_sync_attempts ?? 0) + 1,
        next_sync_at: nextSyncTimestamp,
        sync_claimed_at: null,
        ...(syncSuccess
          ? { last_successful_sync_at: new Date().toISOString() }
          : {}),
      };
      const { error } = await supabase
        .from("source_connections")
        .update(update)
        .eq("id", connectionId);
      if (error) {
        throw new Error(
          `Failed to update source connection status: ${error.message}`,
        );
      }
    });

    // 5. Atomically record completion; trigger the briefing when the run is done.
    const runFinished = await step.run("finalize-run", async () => {
      const { data, error } = await supabase.rpc("complete_source_in_run", {
        p_run_id: runId,
        p_connection_id: connectionId,
        p_success: syncSuccess,
      });
      if (error) {
        throw new Error(
          `Failed to finalise sync run ${runId}: ${error.message}`,
        );
      }
      return Boolean(data);
    });

    if (runFinished) {
      // Process the freshly-ingested batch (classify, extract actions /
      // decisions / risks, synthesise topics) BEFORE the briefing, so the memo
      // reads enriched signals. The intelligence step then triggers the memo.
      console.log(
        `[source/sync] run ${runId} complete — triggering intelligence/process for tenant ${tenantId}`,
      );
      await step.sendEvent("trigger-intelligence-processing", {
        name: "intelligence/process",
        data: { tenantId, runId },
      });

      // Registration drift previously left intelligence/process unhandled and
      // silently blocked every Daily Memo. Keep the preferred enriched path,
      // but recover through this existing source-sync function after a durable
      // wait if no briefing has been linked to the run.
      await step.sleep("wait-for-briefing", BRIEFING_FALLBACK_DELAY);
      const hasBriefing = await step.run("check-briefing-produced", async () => {
        const { data, error } = await supabase
          .from("scheduled_sync_runs")
          .select("briefing_id")
          .eq("id", runId)
          .maybeSingle();
        if (error) {
          throw new Error(
            `Failed to check briefing state for sync run ${runId}: ${error.message}`,
          );
        }
        return Boolean(data?.briefing_id);
      });

      if (!hasBriefing) {
        console.warn(
          `[source/sync] run ${runId} has no memo after ${BRIEFING_FALLBACK_DELAY} — triggering briefing/generate fallback`,
        );
        await step.sendEvent("recover-missing-briefing", {
          name: "briefing/generate",
          data: { tenantId, runId },
        });
      }
    }

    return {
      success: syncSuccess,
      itemsFetched,
      nextSyncAt: nextSyncTimestamp,
      runFinished,
    };
  },
);

/**
 * Background handler for Daily Memo generation (ADR-043). Triggered when a sync
 * cycle completes (with a runId) or ad-hoc (without). It runs the same governed
 * agent flow the on-demand path used to call (agentOrchestrationService), builds
 * the memo from freshly-ingested source_items, and records the produced briefing
 * back onto the run.
 *
 * Idempotency: the function-level `idempotency` key dedupes by runId, and the
 * run.briefing_id check guards against re-generating a memo for a cycle that
 * already produced one — so a sync cycle yields exactly one memo.
 */
export const briefingGenerateFunction = inngest.createFunction(
  {
    id: "briefing-generate",
    name: "Generate Daily Memo",
    triggers: [briefingGenerateEvent],
    idempotency: "event.data.runId",
  },
  async ({ event, step }) => {
    const { tenantId, runId } = event.data;
    if (!tenantId) {
      throw new Error("Missing tenantId in event payload");
    }
    const supabase = createSupabaseSecretClient();

    // Guard: a finished cycle that already produced a memo is not regenerated.
    if (runId) {
      const alreadyDone = await step.run(
        "check-existing-briefing",
        async () => {
          const { data } = await supabase
            .from("scheduled_sync_runs")
            .select("briefing_id")
            .eq("id", runId)
            .maybeSingle();
          return Boolean(data?.briefing_id);
        },
      );
      if (alreadyDone) {
        console.log(
          `[briefing/generate] run ${runId} already has a memo — skipping`,
        );
        return { success: true, skipped: true };
      }
    }

    const briefingId = await step.run("generate-memo", async () => {
      const { ctx } = await resolveTenantJobContext(supabase, tenantId);
      if (!ctx.userId) {
        throw new Error(
          `No owner/member found for tenant ${tenantId}; cannot generate memo.`,
        );
      }
      const result = await agentOrchestrationService.run(ctx, {
        kind: "daily_memo",
      });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      const briefingId = result.value.briefingId;
      if (!briefingId) {
        throw new Error(
          `Daily Memo completed without a briefing ID for tenant ${tenantId}`,
        );
      }
      return briefingId;
    });

    // One quiet in-app cue per briefing (deduped by briefingId).
    if (briefingId) {
      await step.run("notify-briefing-ready", async () => {
        const { ctx } = await resolveTenantJobContext(supabase, tenantId);
        if (!ctx.userId) return { notified: false };
        const result = await notificationService.notifyBriefingReady(ctx, briefingId);
        return { notified: result.ok };
      });
    }

    // Record which cycle produced which memo (provenance + idempotency backstop).
    if (runId && briefingId) {
      await step.run("link-run-to-briefing", async () => {
        const { error } = await supabase
          .from("scheduled_sync_runs")
          .update({ briefing_id: briefingId })
          .eq("id", runId)
          .is("briefing_id", null);
        if (error) {
          throw new Error(
            `Failed to link briefing ${briefingId} to sync run ${runId}: ${error.message}`,
          );
        }
      });
    }

    console.log(
      `[briefing/generate] memo ${briefingId ?? "(none)"} generated for tenant ${tenantId}`,
    );
    return { success: true, briefingId, runId: runId ?? null };
  },
);

/**
 * Background handler for intelligence processing (the wired pipelines).
 * Triggered when a sync cycle completes: it runs the intelligence batch
 * (classification, action/decision/risk extraction, topic synthesis) over the
 * freshly-ingested items, then triggers the daily memo so the briefing reads
 * the enriched signals. Each pipeline step is best-effort inside the batch, so
 * a single failure never blocks the briefing.
 *
 * Idempotency: deduped by runId so a cycle is processed once.
 */
export const intelligenceProcessFunction = inngest.createFunction(
  {
    id: "intelligence-process",
    name: "Process Intelligence Pipelines",
    triggers: [intelligenceProcessEvent],
    idempotency: "event.data.runId",
  },
  async ({ event, step }) => {
    const { tenantId, runId } = event.data;
    if (!tenantId) {
      throw new Error("Missing tenantId in event payload");
    }
    const supabase = createSupabaseSecretClient();

    await step.run("run-intelligence-batch", async () => {
      try {
        const { ctx } = await resolveTenantJobContext(supabase, tenantId);
        if (!ctx.userId) {
          throw new Error(
            `No owner/member found for tenant ${tenantId}; cannot process intelligence.`,
          );
        }
        const result = await agentOrchestrationService.run(ctx, {
          kind: "intelligence_batch",
        });
        if (!result.ok) {
          throw new Error(result.error.message);
        }
        return { ok: true };
      } catch (cause) {
        console.error(
          `[intelligence/process] batch failed for tenant ${tenantId}:`,
          cause instanceof Error ? cause.message : cause,
        );
        return { ok: false };
      }
    });

    await step.run("refresh-semantic-links", async () => {
      try {
        const { ctx } = await resolveTenantJobContext(supabase, tenantId);
        if (!ctx.userId) {
          throw new Error(
            `No owner/member found for tenant ${tenantId}; cannot process semantic links.`,
          );
        }
        const result = await semanticLinkingService.processTenant(ctx);
        console.log(
          `[intelligence/process] semantic links refreshed for tenant ${tenantId}: embedded=${result.embedded}, skipped=${result.skipped}, suggested=${result.suggestedLinks}`,
        );
        return result;
      } catch (cause) {
        console.error(
          `[intelligence/process] semantic linking failed for tenant ${tenantId}:`,
          cause instanceof Error ? cause.message : cause,
        );
        return { embedded: 0, skipped: 0, suggestedLinks: 0 };
      }
    });

    // Hand off to the briefing, preserving the runId for idempotency/provenance.
    console.log(
      `[intelligence/process] tenant ${tenantId} processed — triggering briefing/generate`,
    );
    await step.sendEvent("trigger-briefing-generation", {
      name: "briefing/generate",
      data: { tenantId, runId },
    });

    return { success: true, tenantId, runId: runId ?? null };
  },
);

/**
 * Weekly cron dispatcher for the operating review. Every Monday at 06:00 UTC it
 * enumerates tenants and fans out one operating/review job per tenant.
 * concurrency:1 stops overlapping ticks from double-dispatching.
 */
export const operatingReviewDispatchFunction = inngest.createFunction(
  {
    id: "operating-review-dispatch",
    name: "Dispatch Weekly Operating Reviews",
    concurrency: { limit: 1 },
    triggers: [{ cron: "0 6 * * 1" }],
  },
  async ({ step }) => {
    const supabase = createSupabaseSecretClient();

    const tenantIds = await step.run("list-tenants", async () => {
      const { data, error } = await supabase.from("tenants").select("id");
      if (error) throw new Error(`Failed to list tenants: ${error.message}`);
      return (data ?? []).map((t) => t.id as string);
    });

    if (tenantIds.length === 0) return { dispatched: 0 };

    await step.sendEvent(
      "fan-out-operating-reviews",
      tenantIds.map((tenantId) => ({
        name: "operating/review" as const,
        data: { tenantId },
      })),
    );

    console.log(
      `[operating-review-dispatch] dispatched ${tenantIds.length} review(s)`,
    );
    return { dispatched: tenantIds.length };
  },
);

/**
 * Background handler for one tenant's weekly operating review. Rolls the week's
 * signals, decisions, risks, and actions into an operating picture, and writes
 * the tenant owner's private diary reflection for the week. Best-effort: a
 * failure in one step is logged and never blocks the other.
 */
export const operatingReviewFunction = inngest.createFunction(
  {
    id: "operating-review",
    name: "Generate Weekly Operating Review",
    triggers: [operatingReviewEvent],
  },
  async ({ event, step }) => {
    const { tenantId } = event.data;
    if (!tenantId) throw new Error("Missing tenantId in event payload");
    const supabase = createSupabaseSecretClient();

    await step.run("generate-operating-review", async () => {
      const { ctx } = await resolveTenantJobContext(supabase, tenantId);
      const result = await agentOrchestrationService.run(ctx, {
        kind: "weekly_operating_review",
      });
      if (!result.ok) {
        console.error(
          `[operating/review] review failed for tenant ${tenantId}:`,
          result.error.message,
        );
      }
      return { ok: result.ok };
    });

    await step.run("generate-owner-diary-reflection", async () => {
      const { ctx } = await resolveTenantJobContext(supabase, tenantId);
      if (!ctx.userId) return { ok: false };
      const result = await agentOrchestrationService.run(ctx, {
        kind: "diary_reflection",
        input: { userId: ctx.userId },
      });
      if (!result.ok) {
        console.error(
          `[operating/review] diary reflection failed for tenant ${tenantId}:`,
          result.error.message,
        );
      }
      return { ok: result.ok };
    });

    return { success: true, tenantId };
  },
);

/**
 * Every 15 minutes, queue the daily briefing email for tenants whose owner's
 * local briefing time has passed and whose briefing has not yet been handled
 * today. The pre-dispatch check against notification_deliveries keeps the
 * event volume down; the event idempotency key and the delivery-log claim in
 * runDailyBriefingDelivery are the real duplicate-send guards.
 */
export const dailyBriefingEmailDispatchFunction = inngest.createFunction(
  {
    id: "daily-briefing-email-dispatch",
    name: "Dispatch Daily Briefing Emails",
    concurrency: { limit: 1 },
    triggers: [{ cron: "*/15 * * * *" }],
  },
  async ({ step }) => {
    const supabase = createSupabaseSecretClient();

    const due = await step.run("resolve-due-briefings", async () => {
      const { data: tenants, error } = await supabase
        .from("tenants")
        .select("id")
        .eq("status", "active");
      if (error) throw new Error(`Failed to list tenants: ${error.message}`);

      const now = new Date();
      const dispatches: { tenantId: string; dedupeKey: string }[] = [];
      for (const tenant of tenants ?? []) {
        const tenantId = tenant.id as string;
        const { ctx, timezone, briefingTime } = await resolveTenantJobContext(
          supabase,
          tenantId,
        );
        if (!ctx.userId) continue;
        if (!isBriefingDue(now, timezone, briefingTime)) continue;

        const dedupeKey = dailyBriefingDedupeKey(
          tenantId,
          ctx.userId,
          timezone,
          now,
        );
        const { data: existing } = await supabase
          .from("notification_deliveries")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("user_id", ctx.userId)
          .eq("kind", "daily_briefing")
          .eq("dedupe_key", dedupeKey)
          .maybeSingle();
        if (existing) continue;

        dispatches.push({ tenantId, dedupeKey });
      }
      return dispatches;
    });

    if (due.length === 0) return { dispatched: 0 };

    await step.sendEvent(
      "fan-out-daily-briefings",
      due.map((d) => ({
        name: "notification/daily-briefing" as const,
        data: d,
      })),
    );

    console.log(`[briefing-email/dispatch] queued ${due.length} briefing(s)`);
    return { dispatched: due.length };
  },
);

/**
 * Durable per-tenant worker for one daily briefing email. Idempotent twice
 * over: the event dedupe key covers one local calendar day, and the worker
 * claims a unique notification_deliveries row before contacting SendGrid.
 */
export const dailyBriefingEmailFunction = inngest.createFunction(
  {
    id: "daily-briefing-email",
    name: "Send Daily Briefing Email",
    retries: 2,
    idempotency: "event.data.dedupeKey",
    triggers: [dailyBriefingEmailEvent],
  },
  async ({ event, step }) => {
    const { tenantId } = event.data;
    if (!tenantId) throw new Error("Missing tenantId in daily briefing event");
    const supabase = createSupabaseSecretClient();

    const result = await step.run("deliver-daily-briefing", async () => {
      const { ctx, timezone } = await resolveTenantJobContext(supabase, tenantId);
      if (!ctx.userId) return { outcome: "skipped_disabled" as const };
      return runDailyBriefingDelivery({
        tenantId,
        tenantSlug: ctx.tenantSlug,
        userId: ctx.userId,
        timezone,
      });
    });

    console.log(
      `[briefing-email] tenant=${tenantId} outcome=${result.outcome}${"detail" in result && result.detail ? ` detail=${result.detail}` : ""}`,
    );
    return { success: result.outcome !== "failed", ...result };
  },
);

/** Every four hours, fan out one durable ingestion job per enabled tenant. */
export const newsIngestDispatchFunction = inngest.createFunction(
  {
    id: "news-ingest-dispatch",
    name: "Dispatch Scheduled News Ingestion",
    concurrency: { limit: 1 },
    triggers: [{ cron: "0 */4 * * *" }],
  },
  async ({ step }) => {
    const tenantIds = await step.run("list-enabled-news-tenants", () =>
      listEnabledNewsTenantIds(),
    );
    if (tenantIds.length === 0) return { dispatched: 0 };

    const dispatchTime = await step.run("resolve-news-dispatch-time", () =>
      new Date().toISOString(),
    );
    await step.sendEvent(
      "fan-out-news-ingestion",
      tenantIds.map((tenantId) => ({
        name: "news/ingest" as const,
        data: {
          tenantId,
          dedupeKey: newsIngestionDedupeKey(tenantId, new Date(dispatchTime)),
          trigger: "scheduled" as const,
        },
      })),
    );
    console.log(
      `[news/dispatch] queued ${tenantIds.length} enabled tenant(s)`,
    );
    return { dispatched: tenantIds.length };
  },
);

/** Durable per-tenant worker for the real News ingestion pipeline. */
export const newsIngestFunction = inngest.createFunction(
  {
    id: "news-ingest",
    name: "Ingest and Rank News",
    concurrency: { limit: 1 },
    retries: 2,
    idempotency: "event.data.dedupeKey",
    triggers: [newsIngestEvent],
  },
  async ({ event, step }) => {
    const { tenantId, trigger } = event.data;
    if (!tenantId) throw new Error("Missing tenantId in news ingestion event");

    const result = await step.run("run-news-ingestion", () =>
      runNewsIngestion(tenantId),
    );
    console.log(
      `[news/ingest] tenant=${tenantId} trigger=${trigger} fetched=${result.fetched} deduped=${result.deduped} stored=${result.stored} candidates=${result.candidates} providerErrors=${result.providerErrors.length}`,
    );
    return { success: true, tenantId, trigger, ...result };
  },
);
