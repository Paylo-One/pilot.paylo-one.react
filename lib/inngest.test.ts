import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { briefingState, newsMocks } = vi.hoisted(() => ({
  briefingState: { id: null as string | null },
  newsMocks: {
    run: vi.fn(),
    listEnabledTenantIds: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/secret", () => ({
  createSupabaseSecretClient: () => ({
    rpc: (name: string) => {
      if (name === "complete_source_in_run") {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
    from: (table: string) => {
      if (table === "source_connections") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: {
                    id: "connection-1",
                    system: "file_upload",
                    sync_frequency: "daily",
                    failed_sync_attempts: 0,
                  },
                  error: null,
                }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        };
      }
      if (table === "tenants") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { slug: "tenant" }, error: null }),
            }),
          }),
        };
      }
      if (table === "tenant_users") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: { user_id: "user-1", role: "owner" },
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "user_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { timezone: "UTC", briefing_time: "08:00:00" },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "scheduled_sync_runs") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { briefing_id: briefingState.id },
                  error: null,
                }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  }),
}));

vi.mock("@/modules/agent-orchestration", () => ({
  agentOrchestrationService: { run: vi.fn() },
}));
vi.mock("@/modules/semantic-linking", () => ({
  semanticLinkingService: { processTenant: vi.fn() },
}));
vi.mock("@/modules/source-connection/server", () => ({
  getIntegrationAccessToken: vi.fn(),
}));
vi.mock("@/modules/source-connection/github-repos", () => ({
  syncActiveRepositories: vi.fn(),
}));
vi.mock("@/modules/source-connection/notion", () => ({
  syncActiveResources: vi.fn(),
}));
vi.mock("@/modules/source-connection/google", () => ({
  getValidGoogleToken: vi.fn(),
  syncGmail: vi.fn(),
  syncCalendar: vi.fn(),
}));
vi.mock("@/modules/source-connection/microsoft", () => ({
  getValidMicrosoftToken: vi.fn(),
  syncMs365Mail: vi.fn(),
  syncTeams: vi.fn(),
}));
vi.mock("@/modules/source-connection/slack", () => ({
  getValidSlackToken: vi.fn(),
  syncSlackChannels: vi.fn(),
}));
vi.mock("@/modules/source-connection/discord", () => ({
  getValidDiscordToken: vi.fn(),
  syncDiscordChannels: vi.fn(),
}));
vi.mock("@/modules/source-connection/whatsapp-sync", () => ({
  syncActiveWhatsAppMonitors: vi.fn(),
}));
vi.mock("@/modules/news/ingest", () => ({
  runNewsIngestion: newsMocks.run,
}));
vi.mock("@/modules/news/server", () => ({
  listEnabledNewsTenantIds: newsMocks.listEnabledTenantIds,
}));

import {
  BRIEFING_FALLBACK_DELAY,
  newsIngestionDedupeKey,
  newsIngestDispatchFunction,
  newsIngestFunction,
  sourceSyncFunction,
} from "@/lib/inngest";

type SourceSyncHandler = (input: {
  event: {
    data: { runId: string; tenantId: string; connectionId: string };
  };
  step: {
    run: <T>(id: string, fn: () => Promise<T> | T) => Promise<T>;
    sendEvent: ReturnType<typeof vi.fn>;
    sleep: ReturnType<typeof vi.fn>;
  };
}) => Promise<unknown>;

function sourceSyncHandler(): SourceSyncHandler {
  return (sourceSyncFunction as unknown as { fn: SourceSyncHandler }).fn;
}

type NewsDispatchHandler = (input: {
  step: {
    run: <T>(id: string, fn: () => Promise<T> | T) => Promise<T>;
    sendEvent: ReturnType<typeof vi.fn>;
  };
}) => Promise<unknown>;

type NewsIngestHandler = (input: {
  event: {
    data: {
      tenantId: string;
      dedupeKey: string;
      trigger: "scheduled" | "manual" | "internal" | "recovery";
    };
  };
  step: {
    run: <T>(id: string, fn: () => Promise<T> | T) => Promise<T>;
  };
}) => Promise<unknown>;

function newsDispatchHandler(): NewsDispatchHandler {
  return (newsIngestDispatchFunction as unknown as { fn: NewsDispatchHandler })
    .fn;
}

function newsWorkerHandler(): NewsIngestHandler {
  return (newsIngestFunction as unknown as { fn: NewsIngestHandler }).fn;
}

function createStep() {
  return {
    run: <T>(_id: string, fn: () => Promise<T> | T) => Promise.resolve(fn()),
    sendEvent: vi.fn().mockResolvedValue({ ids: ["event-1"] }),
    sleep: vi.fn().mockResolvedValue(undefined),
  };
}

describe("source-sync briefing recovery", () => {
  beforeEach(() => {
    briefingState.id = null;
    newsMocks.run.mockReset();
    newsMocks.listEnabledTenantIds.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to briefing generation when intelligence does not produce one", async () => {
    const step = createStep();

    await sourceSyncHandler()({
      event: {
        data: {
          runId: "run-1",
          tenantId: "tenant-1",
          connectionId: "connection-1",
        },
      },
      step,
    });

    expect(step.sleep).toHaveBeenCalledWith(
      "wait-for-briefing",
      BRIEFING_FALLBACK_DELAY,
    );
    expect(step.sendEvent).toHaveBeenNthCalledWith(
      1,
      "trigger-intelligence-processing",
      {
        name: "intelligence/process",
        data: { tenantId: "tenant-1", runId: "run-1" },
      },
    );
    expect(step.sendEvent).toHaveBeenNthCalledWith(
      2,
      "recover-missing-briefing",
      {
        name: "briefing/generate",
        data: { tenantId: "tenant-1", runId: "run-1" },
      },
    );
  });

  it("does not emit a duplicate fallback after intelligence links a briefing", async () => {
    briefingState.id = "briefing-1";
    const step = createStep();

    await sourceSyncHandler()({
      event: {
        data: {
          runId: "run-1",
          tenantId: "tenant-1",
          connectionId: "connection-1",
        },
      },
      step,
    });

    expect(step.sendEvent).toHaveBeenCalledTimes(1);
    expect(step.sendEvent).toHaveBeenCalledWith(
      "trigger-intelligence-processing",
      {
        name: "intelligence/process",
        data: { tenantId: "tenant-1", runId: "run-1" },
      },
    );
  });
});

describe("durable news ingestion", () => {
  beforeEach(() => {
    newsMocks.run.mockReset();
    newsMocks.listEnabledTenantIds.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fans out a scheduled event for every enabled tenant", async () => {
    newsMocks.listEnabledTenantIds.mockResolvedValue(["tenant-1", "tenant-2"]);
    const sendEvent = vi.fn().mockResolvedValue({ ids: ["one", "two"] });
    const fixedTime = "2026-07-18T08:00:00.000Z";
    const step = {
      run: <T>(id: string, fn: () => Promise<T> | T) =>
        id === "resolve-news-dispatch-time"
          ? Promise.resolve(fixedTime as T)
          : Promise.resolve(fn()),
      sendEvent,
    };

    const result = await newsDispatchHandler()({ step });

    expect(result).toEqual({ dispatched: 2 });
    expect(sendEvent).toHaveBeenCalledWith("fan-out-news-ingestion", [
      {
        name: "news/ingest",
        data: {
          tenantId: "tenant-1",
          dedupeKey: newsIngestionDedupeKey("tenant-1", new Date(fixedTime)),
          trigger: "scheduled",
        },
      },
      {
        name: "news/ingest",
        data: {
          tenantId: "tenant-2",
          dedupeKey: newsIngestionDedupeKey("tenant-2", new Date(fixedTime)),
          trigger: "scheduled",
        },
      },
    ]);
  });

  it("runs the real ingestion pipeline for a tenant event", async () => {
    newsMocks.run.mockResolvedValue({
      fetched: 8,
      deduped: 3,
      stored: 5,
      candidates: 2,
      providerErrors: [],
    });
    const step = {
      run: <T>(_id: string, fn: () => Promise<T> | T) => Promise.resolve(fn()),
    };

    const result = await newsWorkerHandler()({
      event: {
        data: {
          tenantId: "tenant-1",
          dedupeKey: "tenant-1:1",
          trigger: "recovery",
        },
      },
      step,
    });

    expect(newsMocks.run).toHaveBeenCalledWith("tenant-1");
    expect(result).toEqual({
      success: true,
      tenantId: "tenant-1",
      trigger: "recovery",
      fetched: 8,
      deduped: 3,
      stored: 5,
      candidates: 2,
      providerErrors: [],
    });
  });
});
