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
  getIntegrationCredentials: vi.fn(),
  storeIntegrationCredentials: vi.fn(),
}));

vi.mock("@/modules/ingestion/server", () => ({
  ingestProviderItems: ingestProviderItemsMock,
}));

import { syncDiscordChannels } from "./discord";

describe("syncDiscordChannels", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    listActiveScopeItemsMock.mockResolvedValue([
      {
        id: "scope-1",
        system: "discord",
        itemType: "discord_channel",
        externalId: "100",
        name: "Server #general",
        isActive: true,
        includeInDailyMemo: true,
        priority: "high",
        syncCursor: "99",
        metadata: { guildId: "guild-1", guildName: "Server" },
        lastSyncAt: null,
      },
      {
        id: "scope-2",
        system: "discord",
        itemType: "discord_channel",
        externalId: "200",
        name: "Server #private",
        isActive: true,
        includeInDailyMemo: true,
        priority: "normal",
        syncCursor: null,
        metadata: { guildId: "guild-1", guildName: "Server" },
        lastSyncAt: null,
      },
    ]);
    markScopeItemSyncStateMock.mockResolvedValue(undefined);
    ingestProviderItemsMock.mockResolvedValue({ itemCount: 1 });
  });

  it("ingests visible channel messages and reports permission-denied channels", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json([
          {
            id: "101",
            channel_id: "100",
            content: "Ship decision made",
            timestamp: "2026-06-17T09:00:00.000Z",
            author: { id: "u1", username: "alex" },
            reactions: [{ count: 1, emoji: { name: "white_check_mark" } }],
          },
        ]),
      )
      .mockResolvedValueOnce(Response.json({ threads: [] }))
      .mockResolvedValueOnce(new Response("", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncDiscordChannels("tenant-1", "conn-1", "bot-token");

    expect(result).toEqual({ itemCount: 1, scopeCount: 2, deniedCount: 1 });
    expect(ingestProviderItemsMock).toHaveBeenCalledWith(
      "tenant-1",
      "conn-1",
      "discord",
      expect.arrayContaining([
        expect.objectContaining({
          externalId: "discord:100:101",
          author: "alex",
          raw: expect.objectContaining({ scopeItemId: "scope-1", guildId: "guild-1" }),
        }),
      ]),
    );
    expect(markScopeItemSyncStateMock).toHaveBeenCalledWith(
      "tenant-1",
      "scope-1",
      expect.objectContaining({ syncCursor: "101" }),
    );
  });
});
