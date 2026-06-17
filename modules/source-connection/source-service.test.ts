import { describe, expect, it } from "vitest";

import { SOURCE_SYSTEM_LABELS } from "./index";
import { SOURCE_DESCRIPTORS, deriveSourceStatus } from "./source-service";
import type { SourceConnection } from "./index";

describe("source catalogue", () => {
  it("registers Slack and Discord as first-class available sources", () => {
    const slack = SOURCE_DESCRIPTORS.find((d) => d.system === "slack");
    const discord = SOURCE_DESCRIPTORS.find((d) => d.system === "discord");

    expect(SOURCE_SYSTEM_LABELS.slack).toBe("Slack");
    expect(SOURCE_SYSTEM_LABELS.discord).toBe("Discord");
    expect(slack?.connect).toBe("slack_oauth");
    expect(discord?.connect).toBe("discord_oauth");
    expect(slack?.category).toBe("communication");
    expect(discord?.category).toBe("communication");
  });

  it("derives active/paused status from the shared connection model", () => {
    const slack = SOURCE_DESCRIPTORS.find((d) => d.system === "slack")!;
    const base: SourceConnection = {
      id: "c1",
      system: "slack",
      displayName: "Slack",
      status: "connected",
      storagePolicy: "summaries_only",
      createdAt: "2026-06-17T00:00:00.000Z",
      updatedAt: "2026-06-17T00:00:00.000Z",
      autoRefreshEnabled: false,
      syncFrequency: "daily",
      nextSyncAt: null,
      lastSyncStatus: null,
      lastSyncError: null,
      providerWorkspaceId: null,
      providerWorkspaceName: null,
      permissionsGranted: null,
      lastSuccessfulSyncAt: null,
      failedSyncAttempts: 0,
    };

    expect(deriveSourceStatus(slack, base)).toBe("active");
    expect(deriveSourceStatus(slack, { ...base, storagePolicy: "disabled" })).toBe("paused");
  });
});
