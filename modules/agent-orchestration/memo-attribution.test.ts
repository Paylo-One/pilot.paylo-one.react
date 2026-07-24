import { describe, expect, it } from "vitest";
import type { StoredSourceItem } from "@/modules/knowledge-store/server";
import {
  buildAttributedMemoPayload,
  buildAttributedSuggestedActions,
  partitionAttributedExtractions,
  resolveMemoReferenceItems,
  type MemoInput,
  type SuggestedActionInput,
} from "./memo-attribution";

function item(overrides: Partial<StoredSourceItem> & { id: string }): StoredSourceItem {
  return {
    id: overrides.id,
    system: overrides.system ?? "gmail",
    title: overrides.title ?? `Item ${overrides.id}`,
    body: overrides.body ?? null,
    author: overrides.author ?? null,
    occurredAt: overrides.occurredAt ?? "2026-07-20T08:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-07-20T08:00:00.000Z",
  } as StoredSourceItem;
}

function tokenMap(items: StoredSourceItem[]): Map<string, StoredSourceItem> {
  const map = new Map<string, StoredSourceItem>();
  items.forEach((it, index) => map.set(`item-${index + 1}`, it));
  return map;
}

describe("resolveMemoReferenceItems", () => {
  const items = [item({ id: "a" }), item({ id: "b" })];
  const map = tokenMap(items);

  it("resolves known tokens to their real items", () => {
    expect(resolveMemoReferenceItems(["item-1", "item-2"], map).map((i) => i.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("trims whitespace around tokens", () => {
    expect(resolveMemoReferenceItems([" item-1 "], map).map((i) => i.id)).toEqual(["a"]);
  });

  it("de-duplicates repeated tokens", () => {
    expect(resolveMemoReferenceItems(["item-1", "item-1"], map).map((i) => i.id)).toEqual([
      "a",
    ]);
  });

  it("ignores unknown tokens and NEVER fabricates a fallback reference", () => {
    // The core trust invariant: an unresolvable token yields zero references,
    // not a back-filled unrelated item.
    expect(resolveMemoReferenceItems(["item-99"], map)).toEqual([]);
    expect(resolveMemoReferenceItems([], map)).toEqual([]);
  });
});

describe("buildAttributedMemoPayload", () => {
  const items = [
    item({ id: "a", system: "gmail", title: "Budget approved" }),
    item({ id: "b", system: "teams", title: "Incident postmortem" }),
  ];
  const map = tokenMap(items);

  it("keeps attributed sections and attaches their real references", () => {
    const memo: MemoInput = {
      summary: "s",
      sections: [
        { kind: "decisions", title: "T", body: "B", sourceItemIds: ["item-1"], confidence: 0.9 },
      ],
      actions: [],
    };
    const out = buildAttributedMemoPayload(memo, map);
    expect(out.sections).toHaveLength(1);
    expect(out.droppedSections).toBe(0);
    expect(out.sections[0]?.references).toEqual([
      {
        source_item_id: "a",
        source_system: "gmail",
        item_timestamp: "2026-07-20T08:00:00.000Z",
        confidence: 0.9,
        excerpt_or_pointer: "Budget approved",
      },
    ]);
  });

  it("DROPS sections that resolve to zero real references (no fabricated provenance)", () => {
    const memo: MemoInput = {
      summary: "s",
      sections: [
        { kind: "decisions", title: "Real", body: "B", sourceItemIds: ["item-2"] },
        { kind: "risks", title: "Unattributed", body: "B", sourceItemIds: ["item-99"] },
        { kind: "notes", title: "No tokens", body: "B", sourceItemIds: [] },
      ],
      actions: [],
    };
    const out = buildAttributedMemoPayload(memo, map);
    expect(out.sections.map((s) => s.title)).toEqual(["Real"]);
    expect(out.droppedSections).toBe(2);
    // Surviving sections are re-positioned contiguously from 0.
    expect(out.sections[0]?.position).toBe(0);
  });

  it("re-positions surviving sections contiguously after a drop", () => {
    const memo: MemoInput = {
      summary: "s",
      sections: [
        { kind: "a", title: "One", body: "", sourceItemIds: ["item-99"] },
        { kind: "b", title: "Two", body: "", sourceItemIds: ["item-1"] },
        { kind: "c", title: "Three", body: "", sourceItemIds: ["item-2"] },
      ],
      actions: [],
    };
    const out = buildAttributedMemoPayload(memo, map);
    expect(out.sections.map((s) => [s.title, s.position])).toEqual([
      ["Two", 0],
      ["Three", 1],
    ]);
  });

  it("DROPS unattributed actions and keeps attributed ones", () => {
    const memo: MemoInput = {
      summary: "s",
      sections: [{ kind: "x", title: "T", body: "", sourceItemIds: ["item-1"] }],
      actions: [
        { title: "Do X", rationale: "r", sourceItemIds: ["item-1"] },
        { title: "Orphan", rationale: "r", sourceItemIds: [] },
      ],
    };
    const out = buildAttributedMemoPayload(memo, map);
    expect(out.actions.map((a) => a.title)).toEqual(["Do X"]);
    expect(out.actions[0]).toMatchObject({ status: "inbox", created_from: "briefing" });
    expect(out.droppedActions).toBe(1);
  });

  it("defaults confidence and rounds it when the model omits one", () => {
    const memo: MemoInput = {
      summary: "s",
      sections: [{ kind: "x", title: "T", body: "", sourceItemIds: ["item-1"] }],
      actions: [],
    };
    const out = buildAttributedMemoPayload(memo, map);
    expect(out.sections[0]?.references[0]?.confidence).toBe(0.7);
  });
});

describe("partitionAttributedExtractions", () => {
  const items = [item({ id: "a" }), item({ id: "b" })];
  const map = tokenMap(items);

  it("keeps items with a resolvable token and pairs the first real source id", () => {
    const out = partitionAttributedExtractions(
      [
        { title: "Kept", sourceItemIds: ["item-2"] },
        { title: "Also kept", sourceItemIds: ["item-99", "item-1"] },
      ],
      map,
    );
    expect(out.dropped).toBe(0);
    expect(out.attributed.map((a) => [a.item.title, a.sourceItemId])).toEqual([
      ["Kept", "b"],
      ["Also kept", "a"],
    ]);
  });

  it("DROPS extracted rows that resolve to zero real items (no unattributed write)", () => {
    const out = partitionAttributedExtractions(
      [
        { title: "Orphan token", sourceItemIds: ["item-99"] },
        { title: "No tokens", sourceItemIds: [] },
        { title: "Real", sourceItemIds: ["item-1"] },
      ],
      map,
    );
    expect(out.attributed.map((a) => a.item.title)).toEqual(["Real"]);
    expect(out.dropped).toBe(2);
  });

  it("returns an empty partition for no input", () => {
    const out = partitionAttributedExtractions([], map);
    expect(out.attributed).toEqual([]);
    expect(out.dropped).toBe(0);
  });
});

describe("buildAttributedSuggestedActions", () => {
  const items = [
    item({ id: "a", system: "gmail", title: "Renewal owner asked" }),
    item({ id: "b", system: "slack", title: "Vendor deadline" }),
  ];
  const map = tokenMap(items);

  it("keeps attributed actions with their real references and DROPS unattributed ones", () => {
    const inputs: SuggestedActionInput[] = [
      { title: "Reply to renewal", rationale: "r", dueAt: null, sourceItemIds: ["item-1"] },
      { title: "Orphan token", rationale: "r", dueAt: null, sourceItemIds: ["item-99"] },
      { title: "No tokens", rationale: "r", dueAt: null, sourceItemIds: [] },
    ];
    const out = buildAttributedSuggestedActions(inputs, map);
    expect(out.actions.map((a) => a.title)).toEqual(["Reply to renewal"]);
    expect(out.droppedUnattributed).toBe(2);
    expect(out.actions[0]).toMatchObject({ status: "inbox", created_from: "suggestion" });
    expect(out.actions[0]?.references).toEqual([
      {
        source_item_id: "a",
        source_system: "gmail",
        item_timestamp: "2026-07-20T08:00:00.000Z",
        confidence: 0.7,
        excerpt_or_pointer: "Renewal owner asked",
      },
    ]);
  });

  it("de-duplicates references and preserves a supplied due date", () => {
    const inputs: SuggestedActionInput[] = [
      {
        title: "Chase vendor",
        rationale: "r",
        dueAt: "2026-07-25T09:00:00.000Z",
        sourceItemIds: ["item-2", "item-2", "item-1"],
      },
    ];
    const out = buildAttributedSuggestedActions(inputs, map);
    expect(out.actions[0]?.due_at).toBe("2026-07-25T09:00:00.000Z");
    expect(out.actions[0]?.references.map((r) => r.source_item_id)).toEqual(["b", "a"]);
  });

  it("returns no actions for empty input", () => {
    const out = buildAttributedSuggestedActions([], map);
    expect(out.actions).toEqual([]);
    expect(out.droppedUnattributed).toBe(0);
  });
});
