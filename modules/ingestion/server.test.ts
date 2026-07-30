import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { insertSourceItemMock } = vi.hoisted(() => ({
  insertSourceItemMock: vi.fn(),
}));

// Persistence is the only non-pure dependency of the provider batch path;
// mock it so we can exercise the resilience contract without a database.
vi.mock("@/modules/knowledge-store/server", () => ({
  insertSourceItem: insertSourceItemMock,
}));

// normaliseContent is pure, but importing the real module drags in unrelated
// deps; stub it to a passthrough so the test focuses on batch behaviour.
vi.mock("@/modules/normalisation", () => ({
  normaliseContent: (input: { title?: string | null; body: string; kind?: string | null }) => ({
    title: input.title ?? null,
    body: input.body,
    kind: input.kind ?? "note",
  }),
}));

import { hasIngestableBody, ingestProviderItems } from "./server";
import type { ProviderRawItem } from "./index";

const item = (over: Partial<ProviderRawItem> = {}): ProviderRawItem => ({
  body: "content",
  ...over,
});

describe("hasIngestableBody", () => {
  it("accepts items with non-empty body text", () => {
    expect(hasIngestableBody(item({ body: "hello" }))).toBe(true);
  });

  it("rejects empty or whitespace-only bodies", () => {
    expect(hasIngestableBody(item({ body: "" }))).toBe(false);
    expect(hasIngestableBody(item({ body: "   \n\t" }))).toBe(false);
  });
});

describe("ingestProviderItems", () => {
  beforeEach(() => {
    insertSourceItemMock.mockReset();
    insertSourceItemMock.mockResolvedValue("item-id");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists every ingestable item and reports the count", async () => {
    const result = await ingestProviderItems("tenant-1", "conn-1", "slack", [
      item({ externalId: "a" }),
      item({ externalId: "b" }),
    ]);

    expect(insertSourceItemMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      sourceConnectionId: "conn-1",
      system: "slack",
      itemCount: 2,
      failedCount: 0,
    });
  });

  it("skips empty-body items without counting them as failures", async () => {
    const result = await ingestProviderItems("tenant-1", "conn-1", "slack", [
      item({ body: "" }),
      item({ body: "   " }),
      item({ body: "real" }),
    ]);

    expect(insertSourceItemMock).toHaveBeenCalledTimes(1);
    expect(result.itemCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  it("never throws on a single bad item — it continues and keeps the rest", async () => {
    // Silence the per-item error log for a clean test run.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    insertSourceItemMock
      .mockResolvedValueOnce("ok-1")
      .mockRejectedValueOnce(new Error("row rejected"))
      .mockResolvedValueOnce("ok-3");

    const result = await ingestProviderItems("tenant-1", "conn-1", "email", [
      item({ externalId: "1" }),
      item({ externalId: "2" }),
      item({ externalId: "3" }),
    ]);

    // The whole batch was attempted despite the middle failure.
    expect(insertSourceItemMock).toHaveBeenCalledTimes(3);
    expect(result.itemCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("reports every item failing without throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    insertSourceItemMock.mockRejectedValue(new Error("down"));

    const result = await ingestProviderItems("tenant-1", "conn-1", "teams", [
      item({ externalId: "1" }),
      item({ externalId: "2" }),
    ]);

    expect(result.itemCount).toBe(0);
    expect(result.failedCount).toBe(2);
  });
});
