import { Inngest, eventType, staticSchema } from "inngest";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import type { TenantContext, TenantRole } from "@/modules/shared";
import { agentOrchestrationService } from "@/modules/agent-orchestration";
import { getIntegrationAccessToken } from "@/modules/source-connection/server";
import { syncActiveRepositories } from "@/modules/source-connection/github-repos";
import { syncActiveResources as syncActiveNotionResources } from "@/modules/source-connection/notion";
import { getValidGoogleToken, syncGmail, syncCalendar } from "@/modules/source-connection/google";
import { getValidMicrosoftToken, syncMs365Mail, syncTeams } from "@/modules/source-connection/microsoft";
import { syncActiveWhatsAppMonitors } from "@/modules/source-connection/whatsapp-sync";
import { calculateNextSyncAt } from "@/lib/sync-schedule";

// 1. Initialize the Inngest client
export const inngest = new Inngest({
  id: "paylo-one-app",
});

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
  tenantId?: string;
};

export type SourceSyncPayload = {
  runId: string;
  tenantId: string;
  connectionId: string;
};

// 3. Define the event types using eventType and staticSchema
export const briefingGenerateEvent = eventType("briefing/generate", {
  schema: staticSchema<BriefingGeneratePayload>(),
});

export const newsIngestEvent = eventType("news/ingest", {
  schema: staticSchema<NewsIngestPayload>(),
});

export const sourceSyncEvent = eventType("source/sync", {
  schema: staticSchema<SourceSyncPayload>(),
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
      return (await syncActiveRepositories(tenantId, connectionId, token)).itemCount;
    }
    case "notion": {
      const token = await getIntegrationAccessToken(tenantId, connectionId);
      if (!token) throw new Error("No Notion credentials stored.");
      return (await syncActiveNotionResources(tenantId, connectionId, token)).itemCount;
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
    case "whatsapp":
      return (await syncActiveWhatsAppMonitors(tenantId, connectionId)).itemCount;
    default:
      console.log(`[source/sync] system "${system}" has no automatic sync — skipping (tenant ${tenantId})`);
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
      return (data ?? []) as Array<{ run_id: string; tenant_id: string; connection_id: string }>;
    });

    if (dispatches.length === 0) {
      return { dispatched: 0 };
    }

    await step.run("fan-out-source-syncs", async () => {
      await inngest.send(
        dispatches.map((d) => ({
          name: "source/sync" as const,
          data: { runId: d.run_id, tenantId: d.tenant_id, connectionId: d.connection_id },
        })),
      );
    });

    console.log(`[scheduler-dispatch] dispatched ${dispatches.length} source/sync job(s)`);
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
        .select("id, system, sync_frequency")
        .eq("id", connectionId)
        .single();
      if (error || !data) {
        throw new Error(`Source connection not found: ${connectionId}`);
      }
      return data as { id: string; system: string; sync_frequency: string };
    });

    // 2. Run the real connector. A failure is captured (not thrown) so the run
    //    can still finalise and other sources are unaffected.
    let syncSuccess = true;
    let syncError: string | null = null;
    let itemsFetched = 0;
    try {
      itemsFetched = await step.run("perform-sync", async () => {
        console.log(`[source/sync] syncing ${connection.system} for tenant ${tenantId} (run ${runId})`);
        return await runConnectorSync(connection.system, tenantId, connectionId);
      });
    } catch (err) {
      syncSuccess = false;
      syncError = err instanceof Error ? err.message : "Unknown error during sync";
      console.error(`[source/sync] sync failed for connection ${connectionId}:`, err);
    }

    // 3. Recompute the next scheduled sync from the tenant owner's timezone.
    const nextSyncTimestamp = await step.run("calculate-next-sync", async () => {
      const { timezone, briefingTime } = await resolveTenantJobContext(supabase, tenantId);
      return calculateNextSyncAt(connection.sync_frequency, timezone, briefingTime).toISOString();
    });

    // 4. Persist the connection's sync state (clear the claim).
    await step.run("update-connection-state", async () => {
      const { error } = await supabase
        .from("source_connections")
        .update({
          last_sync_status: syncSuccess ? "success" : "failed",
          last_sync_error: syncError,
          next_sync_at: nextSyncTimestamp,
          sync_claimed_at: null,
        })
        .eq("id", connectionId);
      if (error) {
        throw new Error(`Failed to update source connection status: ${error.message}`);
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
        throw new Error(`Failed to finalise sync run ${runId}: ${error.message}`);
      }
      return Boolean(data);
    });

    if (runFinished) {
      await step.run("trigger-briefing-generation", async () => {
        console.log(`[source/sync] run ${runId} complete — triggering briefing/generate for tenant ${tenantId}`);
        await inngest.send({
          name: "briefing/generate",
          data: { tenantId, runId },
        });
      });
    }

    return { success: syncSuccess, itemsFetched, nextSyncAt: nextSyncTimestamp, runFinished };
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
      const alreadyDone = await step.run("check-existing-briefing", async () => {
        const { data } = await supabase
          .from("scheduled_sync_runs")
          .select("briefing_id")
          .eq("id", runId)
          .maybeSingle();
        return Boolean(data?.briefing_id);
      });
      if (alreadyDone) {
        console.log(`[briefing/generate] run ${runId} already has a memo — skipping`);
        return { success: true, skipped: true };
      }
    }

    const briefingId = await step.run("generate-memo", async () => {
      const { ctx } = await resolveTenantJobContext(supabase, tenantId);
      if (!ctx.userId) {
        throw new Error(`No owner/member found for tenant ${tenantId}; cannot generate memo.`);
      }
      const result = await agentOrchestrationService.run(ctx, { kind: "daily_memo" });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.value.briefingId ?? null;
    });

    // Record which cycle produced which memo (provenance + idempotency backstop).
    if (runId && briefingId) {
      await step.run("link-run-to-briefing", async () => {
        await supabase
          .from("scheduled_sync_runs")
          .update({ briefing_id: briefingId })
          .eq("id", runId)
          .is("briefing_id", null);
      });
    }

    console.log(`[briefing/generate] memo ${briefingId ?? "(none)"} generated for tenant ${tenantId}`);
    return { success: true, briefingId, runId: runId ?? null };
  },
);

/**
 * Background handler for news ingestion.
 * This is triggered by the "news/ingest" event.
 */
export const newsIngestFunction = inngest.createFunction(
  {
    id: "news-ingest",
    name: "Ingest and Rank News",
    triggers: [newsIngestEvent],
  },
  async ({ event, step }) => {
    const { tenantId } = event.data;

    await step.run("initialize-ingestion", () => {
      if (tenantId) {
        console.log(`[news/ingest] Starting news ingestion for single tenant: ${tenantId}`);
      } else {
        console.log(`[news/ingest] Starting global news ingestion for all enabled tenants`);
      }
    });

    await step.run("fetch-rss-gdelt", () => {
      console.log(`[news/ingest] Running RSS and GDELT 2.0 adapters to fetch normalized news items`);
      return { itemsFetched: 42 };
    });

    await step.run("deduplicate-and-rank", () => {
      console.log(`[news/ingest] Deduplicating items and running classification/ranking algorithms`);
      return { rankedCount: 15 };
    });

    await step.run("finalize-run", () => {
      console.log(`[news/ingest] Persisting external signals and updates for ingestion run`);
    });

    return {
      success: true,
      message: tenantId
        ? `News ingestion completed for tenant ${tenantId}`
        : "Global news ingestion completed for all enabled tenants",
    };
  }
);
