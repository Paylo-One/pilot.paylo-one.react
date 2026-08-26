import { describe, expect, it } from "vitest";
import { ACTION_DRAFT_STORAGE_KEY, consumeActionDraft, storeActionDraft } from "./action-draft";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

describe("Daily Memo action drafts", () => {
  it("carries bounded memo context once without placing it in a URL", () => {
    const session = storage();
    const now = 1_800_000_000_000;
    storeActionDraft(session, {
      title: "Follow up with R&D",
      note: "The launch is blocked & needs a decision.",
      contextId: "tenant-1:user-1",
      createdFrom: "briefing",
    }, now);
    expect(consumeActionDraft(session, "tenant-1:user-1", now)).toEqual({
      title: "Follow up with R&D",
      note: "The launch is blocked & needs a decision.",
      contextId: "tenant-1:user-1",
      createdFrom: "briefing",
      createdAt: now,
    });
    expect(consumeActionDraft(session, "tenant-1:user-1", now)).toBeNull();
  });

  it("rejects malformed storage and clears it", () => {
    const session = storage();
    session.setItem(ACTION_DRAFT_STORAGE_KEY, "not-json");
    expect(consumeActionDraft(session, "tenant-1:user-1")).toBeNull();
    expect(session.length).toBe(0);
  });

  it("discards a draft from another authenticated context", () => {
    const session = storage();
    storeActionDraft(session, { title: "Private follow-up", note: "Sensitive context", contextId: "tenant-1:user-1", createdFrom: "briefing" });
    expect(consumeActionDraft(session, "tenant-2:user-2")).toBeNull();
    expect(session.length).toBe(0);
  });

  it("degrades safely when browser storage cannot be read", () => {
    const denied = storage();
    denied.getItem = () => { throw new DOMException("Denied", "SecurityError"); };
    expect(consumeActionDraft(denied, "tenant-1:user-1")).toBeNull();
  });

  it("bounds content before it crosses into Actions", () => {
    const session = storage();
    storeActionDraft(session, {
      title: "t".repeat(250),
      note: "n".repeat(1_100),
      contextId: "tenant-1:user-1",
      createdFrom: "briefing",
    });
    const result = consumeActionDraft(session, "tenant-1:user-1");
    expect(result?.title).toHaveLength(200);
    expect(result?.note).toHaveLength(1_000);
  });

  it("discards a stale draft from an earlier visit", () => {
    const session = storage();
    const createdAt = 1_800_000_000_000;
    storeActionDraft(session, {
      title: "Old follow up",
      note: "No longer current",
      contextId: "tenant-1:user-1",
      createdFrom: "briefing",
    }, createdAt);
    expect(consumeActionDraft(session, "tenant-1:user-1", createdAt + 15 * 60 * 1_000 + 1)).toBeNull();
  });

  it("accepts a draft at the exact 15-minute boundary", () => {
    const session = storage();
    const createdAt = 1_800_000_000_000;
    storeActionDraft(session, {
      title: "Boundary follow up",
      note: "Still current",
      contextId: "tenant-1:user-1",
      createdFrom: "briefing",
    }, createdAt);
    expect(consumeActionDraft(session, "tenant-1:user-1", createdAt + 15 * 60 * 1_000))
      .toMatchObject({ title: "Boundary follow up" });
  });

  it("discards a future-dated draft", () => {
    const session = storage();
    const now = 1_800_000_000_000;
    storeActionDraft(session, {
      title: "Suspicious follow up",
      note: "Future context",
      contextId: "tenant-1:user-1",
      createdFrom: "briefing",
    }, now + 1);
    expect(consumeActionDraft(session, "tenant-1:user-1", now)).toBeNull();
  });

  it("surfaces storage write denial to the caller", () => {
    const denied = storage();
    denied.setItem = () => { throw new DOMException("Denied", "SecurityError"); };
    expect(() => storeActionDraft(denied, {
      title: "Follow up",
      note: "Context",
      contextId: "tenant-1:user-1",
      createdFrom: "briefing",
    })).toThrow(/Denied/);
  });
});
