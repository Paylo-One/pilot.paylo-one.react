/**
 * app/(app)/actions/board-model.ts
 *
 * Pure board logic for the Actions Kanban: column definitions, grouping,
 * ordering, and duplicate-review grouping. No React, no IO — everything here
 * is unit-testable and shared between the board and its tests.
 */

import type {
  SuggestedActionView,
  ActionStatus,
} from "@/modules/action-extraction/server";

export type BoardColumnId =
  | "to_approve"
  | "planned"
  | "in_progress"
  | "waiting"
  | "done";

export interface BoardColumn {
  readonly id: BoardColumnId;
  readonly title: string;
  readonly hint: string;
  /** Statuses that live in this column. */
  readonly statuses: readonly ActionStatus[];
  /** Status applied when a card is dropped here. */
  readonly dropStatus: ActionStatus;
}

export const BOARD_COLUMNS: readonly BoardColumn[] = [
  {
    id: "to_approve",
    title: "To review",
    hint: "Suggestions waiting for your decision.",
    statuses: ["inbox"],
    dropStatus: "inbox",
  },
  {
    id: "planned",
    title: "Planned",
    hint: "Approved and scheduled work.",
    statuses: ["planned", "follow_up"],
    dropStatus: "planned",
  },
  {
    id: "in_progress",
    title: "In progress",
    hint: "What you are on right now.",
    statuses: ["in_progress"],
    dropStatus: "in_progress",
  },
  {
    id: "waiting",
    title: "Waiting on",
    hint: "Open loops owned by someone else.",
    statuses: ["waiting"],
    dropStatus: "waiting",
  },
  {
    id: "done",
    title: "Done",
    hint: "Completed and dismissed from the last week.",
    statuses: ["completed", "cancelled"],
    dropStatus: "completed",
  },
] as const;

/** Done shows the last week by default; older items page in on request. */
export const DONE_RECENT_DAYS = 7;
export const DONE_PAGE_SIZE = 20;

export function columnForStatus(status: ActionStatus): BoardColumnId {
  const column = BOARD_COLUMNS.find((col) => col.statuses.includes(status));
  return column?.id ?? "planned";
}

export function statusForDrop(columnId: BoardColumnId): ActionStatus {
  const column = BOARD_COLUMNS.find((col) => col.id === columnId);
  return column?.dropStatus ?? "planned";
}

export function isOverdue(action: SuggestedActionView, now: Date = new Date()): boolean {
  return Boolean(
    action.dueAt &&
      new Date(action.dueAt) < now &&
      action.status !== "completed" &&
      action.status !== "cancelled",
  );
}

const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Urgent first: overdue, then priority, then nearest date, then newest. */
export function compareBoardCards(
  a: SuggestedActionView,
  b: SuggestedActionView,
  now: Date = new Date(),
): number {
  const overdueDelta = Number(isOverdue(b, now)) - Number(isOverdue(a, now));
  if (overdueDelta !== 0) return overdueDelta;
  const priorityDelta =
    (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
  if (priorityDelta !== 0) return priorityDelta;
  const aDate = a.dueAt ?? a.followUpAt ?? null;
  const bDate = b.dueAt ?? b.followUpAt ?? null;
  if (aDate && bDate && aDate !== bDate) return aDate < bDate ? -1 : 1;
  if (aDate && !bDate) return -1;
  if (!aDate && bDate) return 1;
  return a.createdAt < b.createdAt ? 1 : -1;
}

/** Done column: most recently finished first. */
function compareDoneCards(a: SuggestedActionView, b: SuggestedActionView): number {
  const aStamp = a.completedAt ?? a.createdAt;
  const bStamp = b.completedAt ?? b.createdAt;
  return aStamp < bStamp ? 1 : -1;
}

/** When an item was finished, for the Done column's recency window. */
export function finishedAt(action: SuggestedActionView): string {
  return action.completedAt ?? action.createdAt;
}

/**
 * Split a sorted Done list into the default view (finished within the last
 * week) and the older tail behind the "Show older" control.
 */
export function partitionDoneCards(
  done: readonly SuggestedActionView[],
  now: Date = new Date(),
): { recent: SuggestedActionView[]; older: SuggestedActionView[] } {
  const cutoff = new Date(now.getTime() - DONE_RECENT_DAYS * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();
  const recent: SuggestedActionView[] = [];
  const older: SuggestedActionView[] = [];
  for (const action of done) {
    (finishedAt(action) >= cutoffIso ? recent : older).push(action);
  }
  return { recent, older };
}

export type BoardGroups = Record<BoardColumnId, SuggestedActionView[]>;

export function groupActionsIntoColumns(
  actions: readonly SuggestedActionView[],
  now: Date = new Date(),
): BoardGroups {
  const groups: BoardGroups = {
    to_approve: [],
    planned: [],
    in_progress: [],
    waiting: [],
    done: [],
  };
  for (const action of actions) {
    groups[columnForStatus(action.status)].push(action);
  }
  groups.to_approve.sort((a, b) => compareBoardCards(a, b, now));
  groups.planned.sort((a, b) => compareBoardCards(a, b, now));
  groups.in_progress.sort((a, b) => compareBoardCards(a, b, now));
  groups.waiting.sort((a, b) => compareBoardCards(a, b, now));
  groups.done.sort(compareDoneCards);
  return groups;
}

// ---------------------------------------------------------------------------
// Duplicate review groups
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = new Set<ActionStatus>([
  "inbox",
  "planned",
  "in_progress",
  "waiting",
  "follow_up",
]);

export function isActive(action: SuggestedActionView): boolean {
  return ACTIVE_STATUSES.has(action.status);
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "by", "for", "from", "in", "of", "on",
  "or", "the", "to", "with", "follow", "up", "check", "sync", "align",
]);

function tokensFor(action: SuggestedActionView): Set<string> {
  const raw = `${action.title} ${action.description ?? ""} ${(action.topics ?? []).join(" ")}`;
  return new Set(
    raw
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  );
}

function tokenSimilarity(a: SuggestedActionView, b: SuggestedActionView): number {
  const aTokens = tokensFor(a);
  const bTokens = tokensFor(b);
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  let score = overlap / union;
  if (a.personId && a.personId === b.personId) score += 0.16;
  if ((a.topics ?? []).some((topic) => b.topics.includes(topic))) score += 0.14;
  return Math.min(score, 1);
}

function attentionRank(action: SuggestedActionView): number {
  let score = 0;
  if (action.status === "inbox") score += 8;
  if (action.priority === "critical") score += 7;
  if (action.priority === "high") score += 5;
  if (action.dueAt && new Date(action.dueAt) <= new Date()) score += 6;
  if (action.personId) score += 1;
  return score;
}

export interface DuplicateGroup {
  readonly id: string;
  readonly primary: SuggestedActionView;
  readonly duplicates: SuggestedActionView[];
  readonly confidence: "High" | "Medium";
  readonly reason: string;
}

/**
 * Duplicate review groups from two signals: server-side semantic flags
 * (duplicate_group_id written at generation time) take precedence; the
 * client-side token heuristic still covers older data. Each action appears in
 * at most one group.
 */
export function buildDuplicateGroups(
  actions: readonly SuggestedActionView[],
): DuplicateGroup[] {
  const byId = new Map(actions.map((action) => [action.id, action]));
  const used = new Set<string>();
  const groups: DuplicateGroup[] = [];

  // 1. Server-flagged pairs: candidate -> the open action it matched.
  const flaggedByTarget = new Map<string, SuggestedActionView[]>();
  for (const action of actions) {
    if (!isActive(action) || !action.duplicateGroupId) continue;
    const target = byId.get(action.duplicateGroupId);
    if (!target || !isActive(target) || target.id === action.id) continue;
    const list = flaggedByTarget.get(target.id) ?? [];
    list.push(action);
    flaggedByTarget.set(target.id, list);
  }
  for (const [targetId, flagged] of flaggedByTarget) {
    const target = byId.get(targetId);
    if (!target || used.has(targetId)) continue;
    const duplicates = flagged.filter((item) => !used.has(item.id));
    if (duplicates.length === 0) continue;
    used.add(targetId);
    duplicates.forEach((item) => used.add(item.id));
    const topConfidence = Math.max(
      ...duplicates.map((item) => item.duplicateConfidence ?? 0),
    );
    groups.push({
      id: [targetId, ...duplicates.map((item) => item.id)].sort().join(":"),
      primary: target,
      duplicates,
      confidence: topConfidence >= 0.8 ? "High" : "Medium",
      reason: "Pilot matched these while creating the suggestion.",
    });
  }

  // 2. Token-overlap heuristic for anything not already grouped.
  const candidates = actions.filter((action) => isActive(action) && !used.has(action.id));
  for (const action of candidates) {
    if (used.has(action.id)) continue;
    const matches = candidates
      .filter((candidate) => candidate.id !== action.id && !used.has(candidate.id))
      .map((candidate) => ({ action: candidate, score: tokenSimilarity(action, candidate) }))
      .filter(({ score }) => score >= 0.48)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
    if (matches.length === 0) continue;
    const cluster = [action, ...matches.map((match) => match.action)].sort(
      (a, b) => attentionRank(b) - attentionRank(a),
    );
    const [primary, ...duplicates] = cluster;
    if (!primary || duplicates.length === 0) continue;
    cluster.forEach((item) => used.add(item.id));
    const topScore = matches[0]?.score ?? 0.48;
    groups.push({
      id: cluster.map((item) => item.id).sort().join(":"),
      primary,
      duplicates,
      confidence: topScore >= 0.7 ? "High" : "Medium",
      reason:
        primary.personId && duplicates.some((item) => item.personId === primary.personId)
          ? "Same person and overlapping wording."
          : "Similar wording, topic, or source context.",
    });
  }

  return groups;
}
