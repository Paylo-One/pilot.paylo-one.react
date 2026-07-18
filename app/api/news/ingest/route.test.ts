import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { enqueue, listEnabledTenantIds } = vi.hoisted(() => ({
  enqueue: vi.fn(),
  listEnabledTenantIds: vi.fn(),
}));

vi.mock("@/lib/inngest", () => ({ enqueueNewsIngestions: enqueue }));
vi.mock("@/modules/news/server", () => ({
  listEnabledNewsTenantIds: listEnabledTenantIds,
}));

import { POST } from "./route";

const token = "test-news-token";

function request(body: string, authorization = `Bearer ${token}`): Request {
  return new Request("http://localhost/api/news/ingest", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body,
  });
}

describe("POST /api/news/ingest", () => {
  beforeEach(() => {
    process.env.NEWS_INGESTION_TOKEN = token;
    enqueue.mockReset().mockResolvedValue(["event-1"]);
    listEnabledTenantIds.mockReset();
  });

  afterEach(() => {
    delete process.env.NEWS_INGESTION_TOKEN;
  });

  it("rejects an invalid bearer token", async () => {
    const response = await POST(request("{}", "Bearer wrong"));

    expect(response.status).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("queues all enabled tenants when tenantId is omitted", async () => {
    listEnabledTenantIds.mockResolvedValue(["tenant-1", "tenant-2"]);
    enqueue.mockResolvedValue(["event-1", "event-2"]);

    const response = await POST(request("{}"));

    expect(response.status).toBe(202);
    expect(enqueue).toHaveBeenCalledWith(["tenant-1", "tenant-2"], "internal");
    await expect(response.json()).resolves.toEqual({
      queued: ["tenant-1", "tenant-2"],
      eventIds: ["event-1", "event-2"],
    });
  });

  it("queues only the requested tenant", async () => {
    const tenantId = "74f0a118-98c8-4144-a79e-b15575e0b01e";

    const response = await POST(request(JSON.stringify({ tenantId })));

    expect(response.status).toBe(202);
    expect(listEnabledTenantIds).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith([tenantId], "internal");
  });
});
