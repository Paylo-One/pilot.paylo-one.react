import { beforeEach, describe, expect, it, vi } from "vitest";

const { listActiveScopeItemsMock, markScopeItemSyncStateMock, ingestProviderItemsMock } =
  vi.hoisted(() => ({
    listActiveScopeItemsMock: vi.fn(),
    markScopeItemSyncStateMock: vi.fn(),
    ingestProviderItemsMock: vi.fn(),
  }));

vi.mock("./source-scope", () => ({
  listActiveScopeItems: listActiveScopeItemsMock,
  markScopeItemSyncState: markScopeItemSyncStateMock,
}));

vi.mock("./server", () => ({
  getIntegrationCredentials: vi.fn().mockResolvedValue({ scope: JSON.stringify({ teamId: "T1" }) }),
  storeIntegrationCredentials: vi.fn(),
}));

vi.mock("@/modules/ingestion/server", () => ({
  ingestProviderItems: ingestProviderItemsMock,
}));

import { syncSlackChannels } from "./slack";

describe("syncSlackChannels", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    listActiveScopeItemsMock.mockResolvedValue([
      {
        id: "scope-1",
        system: "slack",
        itemType: "slack_channel",
        externalId: "C1",
        name: "#general",
        isActive: true,
        includeInDailyMemo: true,
        priority: "normal",
        syncCursor: "1718600000.000000",
        metadata: null,
        lastSyncAt: null,
      },
    ]);
    markScopeItemSyncStateMock.mockResolvedValue(undefined);
    ingestProviderItemsMock.mockResolvedValue({ itemCount: 1 });
  });

  it("retries a Slack 429, ingests messages, and advances the channel cursor", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          messages: [
            {
              type: "message",
              user: "U1",
              text: "Please follow up https://example.com",
              ts: "1718600100.000000",
              reactions: [{ name: "thumbsup", count: 2 }],
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncSlackChannels("tenant-1", "conn-1", "xoxb-token");

    expect(result).toEqual({ itemCount: 1, scopeCount: 1 });
    expect(ingestProviderItemsMock).toHaveBeenCalledWith(
      "tenant-1",
      "conn-1",
      "slack",
      expect.arrayContaining([
        expect.objectContaining({
          externalId: "slack:C1:1718600100.000000",
          author: "U1",
          raw: expect.objectContaining({ scopeItemId: "scope-1", channelId: "C1" }),
        }),
      ]),
    );
    expect(markScopeItemSyncStateMock).toHaveBeenCalledWith(
      "tenant-1",
      "scope-1",
      expect.objectContaining({ syncCursor: "1718600100.000000" }),
    );
  });
});
