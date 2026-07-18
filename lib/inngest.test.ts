import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { briefingState } = vi.hoisted(() => ({
  briefingState: { id: null as string | null },
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

import {
  BRIEFING_FALLBACK_DELAY,
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
