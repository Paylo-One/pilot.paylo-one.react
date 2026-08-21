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
    storeActionDraft(session, {
      title: "Follow up with R&D",
      note: "The launch is blocked & needs a decision.",
      contextId: "tenant-1:user-1",
    });
    expect(consumeActionDraft(session, "tenant-1:user-1")).toEqual({
      title: "Follow up with R&D",
      note: "The launch is blocked & needs a decision.",
      contextId: "tenant-1:user-1",
    });
    expect(consumeActionDraft(session, "tenant-1:user-1")).toBeNull();
  });

  it("rejects malformed storage and clears it", () => {
    const session = storage();
    session.setItem(ACTION_DRAFT_STORAGE_KEY, "not-json");
    expect(consumeActionDraft(session, "tenant-1:user-1")).toBeNull();
    expect(session.length).toBe(0);
  });

  it("discards a draft from another authenticated context", () => {
    const session = storage();
    storeActionDraft(session, { title: "Private follow-up", note: "Sensitive context", contextId: "tenant-1:user-1" });
    expect(consumeActionDraft(session, "tenant-2:user-2")).toBeNull();
    expect(session.length).toBe(0);
  });

  it("degrades safely when browser storage cannot be read", () => {
    const denied = storage();
    denied.getItem = () => { throw new DOMException("Denied", "SecurityError"); };
    expect(consumeActionDraft(denied, "tenant-1:user-1")).toBeNull();
  });
});
