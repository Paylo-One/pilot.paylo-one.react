import { describe, expect, it } from "vitest";
import type { SuggestedActionView, ActionStatus } from "@/modules/action-extraction/server";
import {
  BOARD_COLUMNS,
  DONE_RECENT_DAYS,
  buildDuplicateGroups,
  columnForStatus,
  compareBoardCards,
  groupActionsIntoColumns,
  isOverdue,
  partitionDoneCards,
  statusForDrop,
} from "./board-model";

let seq = 0;
function action(overrides: Partial<SuggestedActionView> = {}): SuggestedActionView {
  seq += 1;
  return {
    id: overrides.id ?? `action-${seq}`,
    status: "planned",
    title: `Action ${seq}`,
    rationale: null,
    dueAt: null,
    personId: null,
    createdAt: new Date(2026, 6, 1 + (seq % 20)).toISOString(),
    description: null,
    followUpAt: null,
    priority: "normal",
    completedAt: null,
    snoozedUntil: null,
    createdBy: null,
    createdFrom: "manual",
    topics: [],
    snoozeMetadata: null,
    completionMetadata: null,
    documents: [],
    duplicateGroupId: null,
    duplicateConfidence: null,
    duplicateReason: null,
    references: [],
    ...overrides,
  };
}

describe("column mapping", () => {
  it("maps every status to exactly one column", () => {
    const statuses: ActionStatus[] = [
      "inbox",
      "planned",
      "in_progress",
      "waiting",
      "follow_up",
      "completed",
      "cancelled",
    ];
    for (const status of statuses) {
      const owners = BOARD_COLUMNS.filter((column) => column.statuses.includes(status));
      expect(owners).toHaveLength(1);
    }
  });

  it("groups follow_up with planned and cancelled with done", () => {
    expect(columnForStatus("follow_up")).toBe("planned");
    expect(columnForStatus("cancelled")).toBe("done");
    expect(columnForStatus("inbox")).toBe("to_approve");
  });

  it("dropping on a column yields its drop status", () => {
    expect(statusForDrop("planned")).toBe("planned");
    expect(statusForDrop("in_progress")).toBe("in_progress");
    expect(statusForDrop("waiting")).toBe("waiting");
    expect(statusForDrop("done")).toBe("completed");
  });
});

describe("groupActionsIntoColumns", () => {
  it("places actions into their workflow columns", () => {
    const groups = groupActionsIntoColumns([
      action({ id: "a", status: "inbox" }),
      action({ id: "b", status: "planned" }),
      action({ id: "c", status: "follow_up" }),
      action({ id: "d", status: "in_progress" }),
      action({ id: "e", status: "waiting" }),
      action({ id: "f", status: "completed" }),
      action({ id: "g", status: "cancelled" }),
    ]);
    expect(groups.to_approve.map((a) => a.id)).toEqual(["a"]);
    expect(groups.planned.map((a) => a.id).sort()).toEqual(["b", "c"]);
    expect(groups.in_progress.map((a) => a.id)).toEqual(["d"]);
    expect(groups.waiting.map((a) => a.id)).toEqual(["e"]);
    expect(groups.done.map((a) => a.id).sort()).toEqual(["f", "g"]);
  });

  it("keeps every finished item in done, newest first", () => {
    const finished = Array.from({ length: 30 }, (_, index) =>
      action({
        id: `done-${index}`,
        status: "completed",
        completedAt: new Date(2026, 5, 1 + index).toISOString(),
      }),
    );
    const groups = groupActionsIntoColumns(finished);
    expect(groups.done).toHaveLength(30);
    expect(groups.done[0]?.id).toBe("done-29");
  });

  it("orders urgent work first within a column", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    const overdue = action({ id: "overdue", dueAt: "2026-07-01T00:00:00Z" });
    const critical = action({ id: "critical", priority: "critical" });
    const dated = action({ id: "dated", dueAt: "2026-08-05T00:00:00Z" });
    const plain = action({ id: "plain" });
    const groups = groupActionsIntoColumns([plain, dated, critical, overdue], now);
    expect(groups.planned.map((a) => a.id)).toEqual([
      "overdue",
      "critical",
      "dated",
      "plain",
    ]);
  });
});

describe("partitionDoneCards", () => {
  const now = new Date("2026-07-30T12:00:00Z");

  it("splits done items at the one-week boundary", () => {
    const fresh = action({
      id: "fresh",
      status: "completed",
      completedAt: "2026-07-28T10:00:00Z",
    });
    const boundary = action({
      id: "boundary",
      status: "completed",
      completedAt: new Date(
        now.getTime() - (DONE_RECENT_DAYS * 24 - 1) * 60 * 60 * 1000,
      ).toISOString(),
    });
    const old = action({
      id: "old",
      status: "completed",
      completedAt: "2026-07-01T10:00:00Z",
    });
    const { recent, older } = partitionDoneCards([fresh, boundary, old], now);
    expect(recent.map((item) => item.id).sort()).toEqual(["boundary", "fresh"]);
    expect(older.map((item) => item.id)).toEqual(["old"]);
  });

  it("falls back to createdAt when completedAt is missing", () => {
    const cancelledOld = action({
      id: "cancelled-old",
      status: "cancelled",
      completedAt: null,
      createdAt: "2026-06-01T10:00:00Z",
    });
    const { recent, older } = partitionDoneCards([cancelledOld], now);
    expect(recent).toHaveLength(0);
    expect(older.map((item) => item.id)).toEqual(["cancelled-old"]);
  });

  it("preserves the incoming order within each partition", () => {
    const items = [
      action({ id: "a", status: "completed", completedAt: "2026-07-29T10:00:00Z" }),
      action({ id: "b", status: "completed", completedAt: "2026-07-28T10:00:00Z" }),
      action({ id: "c", status: "completed", completedAt: "2026-07-10T10:00:00Z" }),
      action({ id: "d", status: "completed", completedAt: "2026-07-05T10:00:00Z" }),
    ];
    const { recent, older } = partitionDoneCards(items, now);
    expect(recent.map((item) => item.id)).toEqual(["a", "b"]);
    expect(older.map((item) => item.id)).toEqual(["c", "d"]);
  });
});

describe("isOverdue", () => {
  it("keeps an open action due today out of overdue for the whole day", () => {
    const now = new Date(2026, 6, 30, 23, 59);
    expect(isOverdue(action({ dueAt: "2026-07-29T00:00:00Z" }), now)).toBe(true);
    expect(isOverdue(action({ dueAt: "2026-07-30T00:00:00Z" }), now)).toBe(false);
    expect(isOverdue(action({ dueAt: "2026-07-31T00:00:00Z" }), now)).toBe(false);
  });

  it("never marks a finished action overdue", () => {
    const now = new Date(2026, 6, 30, 12);
    expect(
      isOverdue(action({ dueAt: "2026-07-29T00:00:00Z", status: "completed" }), now),
    ).toBe(false);
    expect(
      isOverdue(action({ dueAt: "2026-07-29T00:00:00Z", status: "cancelled" }), now),
    ).toBe(false);
  });
});

describe("compareBoardCards", () => {
  it("prefers overdue, then priority, then nearest date", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    const overdueNormal = action({ dueAt: "2026-07-20T00:00:00Z" });
    const futureCritical = action({ priority: "critical", dueAt: "2026-08-20T00:00:00Z" });
    expect(compareBoardCards(overdueNormal, futureCritical, now)).toBeLessThan(0);

    const high = action({ priority: "high" });
    const low = action({ priority: "low" });
    expect(compareBoardCards(high, low, now)).toBeLessThan(0);
  });
});

describe("buildDuplicateGroups", () => {
  it("groups server-flagged candidates with their matched action", () => {
    const target = action({ id: "target", status: "planned", title: "Send the Q3 report" });
    const flagged = action({
      id: "flagged",
      status: "inbox",
      title: "Send Q3 report to the board",
      duplicateGroupId: "target",
      duplicateConfidence: 0.81,
    });
    const groups = buildDuplicateGroups([target, flagged]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.primary.id).toBe("target");
    expect(groups[0]?.duplicates.map((item) => item.id)).toEqual(["flagged"]);
    expect(groups[0]?.confidence).toBe("High");
  });

  it("ignores server flags pointing at closed or missing actions", () => {
    const flagged = action({
      id: "flagged",
      status: "inbox",
      title: "Completely unique title alpha",
      duplicateGroupId: "missing",
      duplicateConfidence: 0.9,
    });
    expect(buildDuplicateGroups([flagged])).toHaveLength(0);
  });

  it("still finds token-overlap duplicates without server flags", () => {
    const one = action({ id: "one", title: "Prepare investor update deck for October" });
    const two = action({ id: "two", title: "Prepare the October investor update deck" });
    const unrelated = action({ id: "three", title: "Book a dentist appointment" });
    const groups = buildDuplicateGroups([one, two, unrelated]);
    expect(groups).toHaveLength(1);
    const ids = [groups[0]!.primary.id, ...groups[0]!.duplicates.map((item) => item.id)].sort();
    expect(ids).toEqual(["one", "two"]);
  });

  it("never places one action in two groups", () => {
    const target = action({ id: "t", title: "Renew the office lease agreement" });
    const flagged = action({
      id: "f",
      title: "Renew office lease agreement with landlord",
      duplicateGroupId: "t",
      duplicateConfidence: 0.75,
    });
    const similar = action({ id: "s", title: "Renew the office lease agreement soon" });
    const groups = buildDuplicateGroups([target, flagged, similar]);
    const seen = new Set<string>();
    for (const group of groups) {
      for (const item of [group.primary, ...group.duplicates]) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
    }
  });
});
