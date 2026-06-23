"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  SuggestedActionView,
  ActionStatus,
  ActionPriority,
} from "@/modules/action-extraction/server";
import {
  createAction,
  updateAction,
  completeAction,
  snoozeAction,
  linkActionPerson,
  mergeDuplicateActions,
  suggestActionMetadata,
} from "./actions";
import type { PersonLinkOption } from "@/components/refinement/person-link-control";

const ACTIVE_STATUSES = new Set<ActionStatus>([
  "inbox",
  "planned",
  "in_progress",
  "waiting",
  "follow_up",
]);

const STATUS_META: Record<
  ActionStatus,
  { label: string; tone: "ok" | "info" | "warn" | "risk" | "neutral" }
> = {
  inbox: { label: "Needs approval", tone: "warn" },
  planned: { label: "Planned", tone: "info" },
  in_progress: { label: "In progress", tone: "ok" },
  waiting: { label: "Waiting on", tone: "neutral" },
  follow_up: { label: "Follow-up", tone: "warn" },
  completed: { label: "Completed", tone: "ok" },
  cancelled: { label: "Not an action", tone: "neutral" },
};

const PRIORITY_LABELS: Record<ActionPriority, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
  low: "Low",
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "follow",
  "up",
  "check",
  "sync",
  "align",
]);

type DuplicateGroup = {
  readonly id: string;
  readonly primary: SuggestedActionView;
  readonly duplicates: SuggestedActionView[];
  readonly confidence: "High" | "Medium";
  readonly reason: string;
};

type CleanupSuggestion = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly action?: SuggestedActionView;
  readonly tone: "info" | "warn" | "risk";
};

function formatDate(value: string | null): string {
  if (!value) return "No date";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function dateInput(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

function addDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function active(action: SuggestedActionView): boolean {
  return ACTIVE_STATUSES.has(action.status);
}

function tokensFor(action: SuggestedActionView): Set<string> {
  const raw = `${action.title} ${action.description ?? ""} ${(action.topics ?? []).join(" ")}`;
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
  return new Set(tokens);
}

function similarity(a: SuggestedActionView, b: SuggestedActionView): number {
  const aTokens = tokensFor(a);
  const bTokens = tokensFor(b);
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  let score = overlap / union;
  if (a.personId && a.personId === b.personId) score += 0.16;
  if ((a.topics ?? []).some((topic) => b.topics.includes(topic))) score += 0.14;
  if (a.createdFrom === b.createdFrom) score += 0.04;
  return Math.min(score, 1);
}

function attentionRank(action: SuggestedActionView): number {
  let score = 0;
  if (action.status === "inbox") score += 8;
  if (action.priority === "critical") score += 7;
  if (action.priority === "high") score += 5;
  if (action.dueAt && new Date(action.dueAt) <= new Date()) score += 6;
  if (action.followUpAt && new Date(action.followUpAt) <= new Date()) score += 4;
  if (action.personId) score += 1;
  return score;
}

function buildDuplicateGroups(actions: readonly SuggestedActionView[]): DuplicateGroup[] {
  const candidates = actions.filter(active);
  const used = new Set<string>();
  const groups: DuplicateGroup[] = [];

  for (const action of candidates) {
    if (used.has(action.id)) continue;
    const matches = candidates
      .filter((candidate) => candidate.id !== action.id && !used.has(candidate.id))
      .map((candidate) => ({ action: candidate, score: similarity(action, candidate) }))
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

function personName(people: readonly PersonLinkOption[], personId: string | null): string | null {
  if (!personId) return null;
  return people.find((person) => person.id === personId)?.displayName ?? null;
}

function statusClass(tone: "ok" | "info" | "warn" | "risk" | "neutral"): string {
  if (tone === "neutral") return "status status--neutral";
  return `status status--${tone}`;
}

function ActionCommandButton({
  children,
  onClick,
  disabled,
  kind = "quiet",
}: {
  readonly children: React.ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly kind?: "primary" | "quiet" | "danger";
}) {
  return (
    <button
      type="button"
      className={`action-command action-command--${kind}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function ActionRow({
  action,
  people,
  selected,
  pending,
  onSelect,
  onQuickStatus,
  onComplete,
  onSnooze,
}: {
  readonly action: SuggestedActionView;
  readonly people: readonly PersonLinkOption[];
  readonly selected: boolean;
  readonly pending: boolean;
  readonly onSelect: () => void;
  readonly onQuickStatus: (status: ActionStatus) => void;
  readonly onComplete: () => void;
  readonly onSnooze: () => void;
}) {
  const status = STATUS_META[action.status];
  const linkedPerson = personName(people, action.personId);
  const overdue =
    action.dueAt &&
    new Date(action.dueAt) < new Date() &&
    action.status !== "completed" &&
    action.status !== "cancelled";
  const tone =
    overdue || action.priority === "critical"
      ? "risk"
      : action.priority === "high"
        ? "warn"
        : status.tone;

  return (
    <article
      className={`action-review-row${selected ? " action-review-row--selected" : ""}`}
      onClick={onSelect}
    >
      <div className={`action-review-row__signal action-review-row__signal--${tone}`} />
      <button type="button" className="action-review-row__main" onClick={onSelect}>
        <span className="action-review-row__title">{action.title}</span>
        <span className="action-review-row__meta">
          <span>{status.label}</span>
          {action.dueAt ? <span>{overdue ? "Overdue" : "Due"} {formatDate(action.dueAt)}</span> : null}
          {action.followUpAt ? <span>Follow up {formatDate(action.followUpAt)}</span> : null}
          {linkedPerson ? <span>With {linkedPerson}</span> : null}
        </span>
        {action.rationale ? <span className="action-review-row__reason">{action.rationale}</span> : null}
      </button>
      <div className="action-review-row__commands" aria-label={`Quick actions for ${action.title}`}>
        {action.status === "inbox" ? (
          <ActionCommandButton disabled={pending} kind="primary" onClick={() => onQuickStatus("planned")}>
            Approve
          </ActionCommandButton>
        ) : null}
        <ActionCommandButton disabled={pending} onClick={onComplete}>
          Complete
        </ActionCommandButton>
        <ActionCommandButton disabled={pending} onClick={onSnooze}>
          Snooze
        </ActionCommandButton>
        <ActionCommandButton disabled={pending} onClick={() => onQuickStatus("waiting")}>
          Waiting
        </ActionCommandButton>
        <ActionCommandButton disabled={pending} kind="danger" onClick={() => onQuickStatus("cancelled")}>
          Not an action
        </ActionCommandButton>
      </div>
    </article>
  );
}

function DuplicateReviewCard({
  group,
  pending,
  onSelect,
  onMerge,
  onDismiss,
  onKeepSeparate,
}: {
  readonly group: DuplicateGroup;
  readonly pending: boolean;
  readonly onSelect: (action: SuggestedActionView) => void;
  readonly onMerge: (approve: boolean) => void;
  readonly onDismiss: () => void;
  readonly onKeepSeparate: () => void;
}) {
  return (
    <section className="duplicate-review">
      <div className="duplicate-review__head">
        <div>
          <p className="duplicate-review__label">Possible duplicate</p>
          <h3>{group.primary.title}</h3>
        </div>
        <span className="status status--info">{group.confidence} confidence</span>
      </div>
      <p className="duplicate-review__why">This looks similar to {group.duplicates.length} other item{group.duplicates.length === 1 ? "" : "s"}. {group.reason}</p>
      <div className="duplicate-review__items">
        <button type="button" onClick={() => onSelect(group.primary)}>
          <strong>Recommended action</strong>
          <span>{group.primary.title}</span>
        </button>
        {group.duplicates.map((duplicate) => (
          <button type="button" key={duplicate.id} onClick={() => onSelect(duplicate)}>
            <strong>Duplicate candidate</strong>
            <span>{duplicate.title}</span>
          </button>
        ))}
      </div>
      <div className="duplicate-review__commands">
        <ActionCommandButton disabled={pending} kind="primary" onClick={() => onMerge(true)}>
          Approve merged action
        </ActionCommandButton>
        <ActionCommandButton disabled={pending} onClick={() => onMerge(false)}>
          Merge actions
        </ActionCommandButton>
        <ActionCommandButton disabled={pending} onClick={onDismiss}>
          Dismiss duplicates
        </ActionCommandButton>
        <ActionCommandButton disabled={pending} onClick={onKeepSeparate}>
          Keep separate
        </ActionCommandButton>
      </div>
    </section>
  );
}

function CleanupPanel({
  suggestions,
  onSelect,
}: {
  readonly suggestions: readonly CleanupSuggestion[];
  readonly onSelect: (action: SuggestedActionView) => void;
}) {
  if (suggestions.length === 0) {
    return (
      <section className="cleanup-panel cleanup-panel--quiet">
        <p className="cleanup-panel__title">Your action list is clean.</p>
        <p>New items will appear here when they need a decision.</p>
      </section>
    );
  }

  return (
    <section className="cleanup-panel">
      <div className="cleanup-panel__head">
        <p className="cleanup-panel__label">Cleanup suggestions</p>
        <span className="actions-count">{suggestions.length}</span>
      </div>
      <div className="cleanup-panel__list">
        {suggestions.slice(0, 4).map((suggestion) => (
          <button
            key={suggestion.id}
            type="button"
            className={`cleanup-suggestion cleanup-suggestion--${suggestion.tone}`}
            onClick={() => suggestion.action && onSelect(suggestion.action)}
            disabled={!suggestion.action}
          >
            <strong>{suggestion.title}</strong>
            <span>{suggestion.body}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ActionInspector({
  action,
  people,
  pending,
  suggestion,
  suggestionPending,
  onStatus,
  onPriority,
  onDueDate,
  onFollowUpDate,
  onPerson,
  onSuggest,
  onApplySuggestion,
}: {
  readonly action: SuggestedActionView | null;
  readonly people: readonly PersonLinkOption[];
  readonly pending: boolean;
  readonly suggestion: {
    topics: string[];
    people: { id: string; displayName: string }[];
    dueAt: string | null;
    followUpAt: string | null;
    priority: ActionPriority;
    waitingOnSomeone: boolean;
  } | null;
  readonly suggestionPending: boolean;
  readonly onStatus: (status: ActionStatus) => void;
  readonly onPriority: (priority: ActionPriority) => void;
  readonly onDueDate: (value: string) => void;
  readonly onFollowUpDate: (value: string) => void;
  readonly onPerson: (personId: string | null) => void;
  readonly onSuggest: () => void;
  readonly onApplySuggestion: () => void;
}) {
  if (!action) {
    return (
      <aside className="actions-inspector actions-inspector--empty">
        <p className="eyebrow">Detail</p>
        <h2>Choose an action to review.</h2>
        <p>Use the list for quick decisions, then open the detail page only when more context is needed.</p>
      </aside>
    );
  }

  const status = STATUS_META[action.status];

  return (
    <aside className="actions-inspector" aria-label="Action detail">
      <div className="actions-inspector__head">
        <div>
          <p className="eyebrow">Action detail</p>
          <h2>{action.title}</h2>
        </div>
        <span className={statusClass(status.tone)}>{status.label}</span>
      </div>

      <div className="actions-inspector__section">
        <p className="actions-inspector__label">Why this exists</p>
        <p className="actions-inspector__prose">
          {action.rationale || action.description || "No supporting context yet. Add a note or open the detail page to enrich it."}
        </p>
      </div>

      <div className="actions-inspector__section action-metadata-grid">
        <label>
          <span>Status</span>
          <select
            className="input"
            value={action.status}
            disabled={pending}
            onChange={(event) => onStatus(event.target.value as ActionStatus)}
          >
            <option value="inbox">Needs approval</option>
            <option value="planned">Planned</option>
            <option value="in_progress">In progress</option>
            <option value="waiting">Waiting on</option>
            <option value="follow_up">Follow-up</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Not an action</option>
          </select>
        </label>
        <label>
          <span>Priority</span>
          <select
            className="input"
            value={action.priority}
            disabled={pending}
            onChange={(event) => onPriority(event.target.value as ActionPriority)}
          >
            {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Due date</span>
          <input
            className="input"
            type="date"
            value={dateInput(action.dueAt)}
            disabled={pending}
            onChange={(event) => onDueDate(event.target.value)}
          />
        </label>
        <label>
          <span>Follow-up</span>
          <input
            className="input"
            type="date"
            value={dateInput(action.followUpAt)}
            disabled={pending}
            onChange={(event) => onFollowUpDate(event.target.value)}
          />
        </label>
        <label className="action-metadata-grid__wide">
          <span>Related person</span>
          <select
            className="input"
            value={action.personId ?? ""}
            disabled={pending}
            onChange={(event) => onPerson(event.target.value || null)}
          >
            <option value="">No person linked</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName}{person.organisation ? `, ${person.organisation}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="actions-inspector__section">
        <div className="actions-inspector__section-head">
          <p className="actions-inspector__label">Context links</p>
          <span className="actions-count">{action.references.length}</span>
        </div>
        {action.references.length > 0 ? (
          <div className="action-source-list">
            {action.references.slice(0, 3).map((reference) => (
              <div className="action-source" key={reference.id}>
                <div className="action-source__head">
                  <strong>{reference.sourceSystem}</strong>
                  <span>{reference.confidence ? `${Math.round(reference.confidence * 100)}%` : "Source"}</span>
                </div>
                <p>{reference.excerptOrPointer || "Source reference recorded."}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="actions-inspector__muted">No source linked yet.</p>
        )}
      </div>

      <div className="actions-inspector__section">
        <div className="actions-inspector__section-head">
          <p className="actions-inspector__label">AI cleanup</p>
          <button type="button" className="action-command" onClick={onSuggest} disabled={suggestionPending}>
            {suggestionPending ? "Reviewing..." : "Suggest next step"}
          </button>
        </div>
        {suggestion ? (
          <div className="ai-cleanup-result">
            <p>
              Suggested priority: <strong>{PRIORITY_LABELS[suggestion.priority]}</strong>
              {suggestion.dueAt ? `, due ${formatDate(suggestion.dueAt)}` : ""}
              {suggestion.followUpAt ? `, follow up ${formatDate(suggestion.followUpAt)}` : ""}
              {suggestion.waitingOnSomeone ? ", waiting on someone" : ""}.
            </p>
            {suggestion.topics.length > 0 ? <p>Topics: {suggestion.topics.join(", ")}</p> : null}
            {suggestion.people.length > 0 ? <p>Person: {suggestion.people.map((person) => person.displayName).join(", ")}</p> : null}
            <button type="button" className="btn btn--secondary" onClick={onApplySuggestion} disabled={pending}>
              Apply proposal
            </button>
          </div>
        ) : (
          <p className="actions-inspector__muted">Ask Pilot to propose missing metadata. Nothing changes until you apply it.</p>
        )}
      </div>

      <div className="actions-inspector__footer">
        <Link className="btn btn--secondary" href={`/actions/${action.id}`}>
          Open full detail
        </Link>
      </div>
    </aside>
  );
}

export function ActionsWorkspace({
  actions,
  people,
}: {
  readonly actions: readonly SuggestedActionView[];
  readonly people: readonly PersonLinkOption[];
}) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<"attention" | "duplicates" | "waiting" | "later" | "done">("attention");
  const [selectedId, setSelectedId] = useState(actions.find(active)?.id ?? actions[0]?.id ?? null);
  const [captureTitle, setCaptureTitle] = useState("");
  const [dismissedDuplicateGroups, setDismissedDuplicateGroups] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<{
    actionId: string;
    value: {
      topics: string[];
      people: { id: string; displayName: string }[];
      dueAt: string | null;
      followUpAt: string | null;
      priority: ActionPriority;
      waitingOnSomeone: boolean;
    };
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSuggesting, startSuggestionTransition] = useTransition();

  const activeActions = useMemo(() => actions.filter(active), [actions]);
  const duplicateGroups = useMemo(
    () => buildDuplicateGroups(actions).filter((group) => !dismissedDuplicateGroups.includes(group.id)),
    [actions, dismissedDuplicateGroups],
  );
  const duplicateIds = useMemo(() => {
    const ids = new Set<string>();
    duplicateGroups.forEach((group) => group.duplicates.forEach((action) => ids.add(action.id)));
    return ids;
  }, [duplicateGroups]);

  const q = searchQuery.toLowerCase().trim();
  const searchableActions = useMemo(() => {
    if (!q) return actions;
    return actions.filter((action) => {
      const linkedPerson = personName(people, action.personId) ?? "";
      return [
        action.title,
        action.description ?? "",
        action.rationale ?? "",
        linkedPerson,
        action.topics.join(" "),
        action.references.map((reference) => `${reference.sourceSystem} ${reference.excerptOrPointer ?? ""}`).join(" "),
      ].some((value) => value.toLowerCase().includes(q));
    });
  }, [actions, people, q]);

  const selectedAction = useMemo(
    () => actions.find((action) => action.id === selectedId) ?? activeActions[0] ?? actions[0] ?? null,
    [actions, activeActions, selectedId],
  );

  const soonEnd = useMemo(() => {
    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const soon = new Date(todayEnd);
    soon.setDate(soon.getDate() + 7);
    return soon;
  }, []);

  const visibleActive = searchableActions.filter((action) => active(action) && !duplicateIds.has(action.id));
  const lanes = useMemo(() => {
    const needsApproval = visibleActive.filter((action) => action.status === "inbox");
    const dueSoon = visibleActive.filter((action) => {
      if (!action.dueAt) return false;
      const date = new Date(action.dueAt);
      return date <= soonEnd && action.status !== "inbox";
    });
    const followUps = visibleActive.filter((action) => {
      if (action.status === "follow_up") return true;
      if (!action.followUpAt) return false;
      return new Date(action.followUpAt) <= soonEnd;
    });
    const waiting = visibleActive.filter((action) => action.status === "waiting");
    const later = visibleActive.filter(
      (action) =>
        !needsApproval.includes(action) &&
        !dueSoon.includes(action) &&
        !followUps.includes(action) &&
        !waiting.includes(action),
    );
    return [
      { id: "needs-approval", title: "Needs approval", hint: "Review once. Keep only what deserves attention.", items: needsApproval },
      { id: "due-soon", title: "Due soon", hint: "Deadlines and near-term commitments.", items: dueSoon },
      { id: "follow-ups", title: "Follow-ups", hint: "People or threads that need a nudge.", items: followUps },
      { id: "waiting", title: "Waiting on someone", hint: "Open loops owned outside your desk.", items: waiting },
      { id: "later", title: "Later / parked", hint: "Useful, but not asking for attention now.", items: later },
    ].filter((lane) => lane.items.length > 0);
  }, [visibleActive, soonEnd]);

  const completedRecently = searchableActions
    .filter((action) => action.status === "completed" || action.status === "cancelled")
    .slice(0, 12);

  const cleanupSuggestions = useMemo<CleanupSuggestion[]>(() => {
    const suggestions: CleanupSuggestion[] = [];
    if (duplicateGroups.length > 0) {
      suggestions.push({
        id: "duplicates",
        title: "Review possible duplicates",
        body: `${duplicateGroups.length} group${duplicateGroups.length === 1 ? "" : "s"} can be cleaned up once.`,
        tone: "warn",
      });
    }
    const inbox = activeActions.filter((action) => action.status === "inbox");
    if (inbox.length >= 8) {
      suggestions.push({
        id: "too-many-inbox",
        title: "Too many unprocessed actions",
        body: "Start with approvals and dismiss anything that is not a real commitment.",
        action: inbox[0],
        tone: "risk",
      });
    }
    const vague = activeActions.find((action) => tokensFor(action).size <= 2);
    if (vague) {
      suggestions.push({
        id: `vague-${vague.id}`,
        title: "Clarify a vague action",
        body: "This item may need a clearer next step before it is useful.",
        action: vague,
        tone: "info",
      });
    }
    const missingDate = activeActions.find(
      (action) => action.priority !== "low" && !action.dueAt && !action.followUpAt,
    );
    if (missingDate) {
      suggestions.push({
        id: `date-${missingDate.id}`,
        title: "Add a date or park it",
        body: "High-attention work should have a deadline, follow-up, or a deliberate parking place.",
        action: missingDate,
        tone: "info",
      });
    }
    const missingPerson = activeActions.find(
      (action) => !action.personId && /\b(with|from|ask|waiting|follow|reply|send)\b/i.test(action.title),
    );
    if (missingPerson) {
      suggestions.push({
        id: `person-${missingPerson.id}`,
        title: "Link a person",
        body: "This looks people-related. Link it so follow-ups are easier to scan.",
        action: missingPerson,
        tone: "info",
      });
    }
    return suggestions;
  }, [activeActions, duplicateGroups]);

  function runMutation(work: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(result.error ?? "That change could not be saved.");
      } else {
        router.refresh();
      }
    });
  }

  function updateSelected(fields: Parameters<typeof updateAction>[1]) {
    if (!selectedAction) return;
    runMutation(() => updateAction(selectedAction.id, fields));
  }

  function createManualAction(event: React.FormEvent) {
    event.preventDefault();
    const title = captureTitle.trim();
    if (!title) return;
    runMutation(async () => {
      const result = await createAction({ title, status: "inbox" });
      if (result.ok) setCaptureTitle("");
      return result;
    });
  }

  function requestSuggestion() {
    if (!selectedAction) return;
    setError(null);
    startSuggestionTransition(async () => {
      const result = await suggestActionMetadata(
        selectedAction.title,
        selectedAction.description ?? selectedAction.rationale ?? undefined,
      );
      if (!result.ok || !result.suggestions) {
        setError(result.error ?? "Pilot could not suggest cleanup for this action.");
        return;
      }
      setAiSuggestion({ actionId: selectedAction.id, value: result.suggestions });
    });
  }

  function applySuggestion() {
    if (!selectedAction || !aiSuggestion || aiSuggestion.actionId !== selectedAction.id) return;
    const suggestion = aiSuggestion.value;
    runMutation(async () => {
      const person = suggestion.people[0];
      const result = await updateAction(selectedAction.id, {
        priority: suggestion.priority,
        dueAt: suggestion.dueAt,
        followUpAt: suggestion.followUpAt,
        topics: suggestion.topics.length > 0 ? suggestion.topics : selectedAction.topics,
        personId: person?.id ?? selectedAction.personId,
        status: suggestion.waitingOnSomeone ? "waiting" : selectedAction.status,
      });
      if (result.ok) setAiSuggestion(null);
      return result;
    });
  }

  const views = [
    { id: "attention", label: "Needs attention", count: activeActions.length - duplicateIds.size },
    { id: "duplicates", label: "Possible duplicates", count: duplicateGroups.length },
    { id: "waiting", label: "Waiting on", count: activeActions.filter((action) => action.status === "waiting").length },
    { id: "later", label: "Later / parked", count: activeActions.filter((action) => action.status === "planned" || action.status === "in_progress").length },
    { id: "done", label: "Completed recently", count: completedRecently.length },
  ] as const;

  return (
    <>
      <div className="actions-command">
        <header className="actions-hero">
          <div>
            <p className="eyebrow">Actions</p>
            <h1 className="page-head__title">Decide, clean up, move on.</h1>
            <p className="page-head__lead">
              Review the smallest useful set of commitments. Merge duplicates, approve the real work, and park the rest.
            </p>
          </div>
          <form className="action-capture-inline" onSubmit={createManualAction}>
            <label htmlFor="quick-action-title">Add a quick action</label>
            <div>
              <input
                id="quick-action-title"
                className="input"
                value={captureTitle}
                onChange={(event) => setCaptureTitle(event.target.value)}
                placeholder="Add the next thing worth tracking"
                disabled={isPending}
              />
              <button type="submit" className="btn btn--primary" disabled={isPending || !captureTitle.trim()}>
                Add
              </button>
            </div>
          </form>
        </header>

        <section className="actions-toolbar" aria-label="Action search and views">
          <div className="actions-search-field">
            <label htmlFor="actions-search">Search</label>
            <input
              id="actions-search"
              className="input"
              type="search"
              value={searchQuery}
              placeholder="Search actions, people, topics, or sources"
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
          <nav className="actions-tabs" aria-label="Action views">
            {views.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`actions-tab${view === item.id ? " actions-tab--active" : ""}`}
                onClick={() => setView(item.id)}
              >
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </button>
            ))}
          </nav>
        </section>

        {error ? <p className="form-message form-message--error" role="alert">{error}</p> : null}

        <div className="actions-layout">
          <div className="actions-left-rail">
            <CleanupPanel suggestions={cleanupSuggestions} onSelect={(action) => setSelectedId(action.id)} />
          </div>

          <main className="actions-review" aria-label="Action review queue">
            {view === "duplicates" ? (
              duplicateGroups.length > 0 ? (
                <div className="actions-review__stack">
                  {duplicateGroups.map((group) => (
                    <DuplicateReviewCard
                      key={group.id}
                      group={group}
                      pending={isPending}
                      onSelect={(action) => setSelectedId(action.id)}
                      onMerge={(approve) =>
                        runMutation(() =>
                          mergeDuplicateActions({
                            primaryActionId: group.primary.id,
                            duplicateActionIds: group.duplicates.map((item) => item.id),
                            approvePrimary: approve,
                            reason: group.reason,
                          }),
                        )
                      }
                      onDismiss={() =>
                        runMutation(() =>
                          mergeDuplicateActions({
                            primaryActionId: group.primary.id,
                            duplicateActionIds: group.duplicates.map((item) => item.id),
                            approvePrimary: false,
                            reason: "Dismissed duplicate candidates from review.",
                          }),
                        )
                      }
                      onKeepSeparate={() =>
                        setDismissedDuplicateGroups((current) => [...current, group.id])
                      }
                    />
                  ))}
                </div>
              ) : (
                <section className="actions-empty-state">
                  <h2>Duplicate review complete.</h2>
                  <p>Nothing similar needs your attention right now.</p>
                </section>
              )
            ) : view === "done" ? (
              completedRecently.length > 0 ? (
                <section className="action-lane">
                  <div className="action-lane__head">
                    <div>
                      <h2>Completed recently</h2>
                      <p>Kept out of your daily review unless you need the record.</p>
                    </div>
                    <span className="actions-count">{completedRecently.length}</span>
                  </div>
                  <div className="action-lane__list">
                    {completedRecently.map((action) => (
                      <ActionRow
                        key={action.id}
                        action={action}
                        people={people}
                        selected={selectedAction?.id === action.id}
                        pending={isPending}
                        onSelect={() => setSelectedId(action.id)}
                        onQuickStatus={(status) => runMutation(() => updateAction(action.id, { status }))}
                        onComplete={() => runMutation(() => completeAction(action.id))}
                        onSnooze={() => runMutation(() => snoozeAction(action.id, addDays(2), "Snoozed from quick triage."))}
                      />
                    ))}
                  </div>
                </section>
              ) : (
                <section className="actions-empty-state">
                  <h2>No completed actions yet.</h2>
                  <p>Complete items from the review queue and they will appear here briefly.</p>
                </section>
              )
            ) : (
              <>
                {view === "waiting" || view === "later" ? null : duplicateGroups.length > 0 ? (
                  <section className="duplicate-summary">
                    <div>
                      <h2>We found a few items that look similar.</h2>
                      <p>Review them once and keep your list clean. Duplicate candidates are grouped instead of shown as full rows.</p>
                    </div>
                    <button type="button" className="btn btn--secondary" onClick={() => setView("duplicates")}>
                      Review duplicates
                    </button>
                  </section>
                ) : null}

                {lanes
                  .filter((lane) => {
                    if (view === "waiting") return lane.id === "waiting";
                    if (view === "later") return lane.id === "later";
                    return view === "attention";
                  })
                  .map((lane) => (
                    <section className="action-lane" key={lane.id}>
                      <div className="action-lane__head">
                        <div>
                          <h2>{lane.title}</h2>
                          <p>{lane.hint}</p>
                        </div>
                        <span className="actions-count">{lane.items.length}</span>
                      </div>
                      <div className="action-lane__list">
                        {lane.items.map((action) => (
                          <ActionRow
                            key={action.id}
                            action={action}
                            people={people}
                            selected={selectedAction?.id === action.id}
                            pending={isPending}
                            onSelect={() => setSelectedId(action.id)}
                            onQuickStatus={(status) => runMutation(() => updateAction(action.id, { status }))}
                            onComplete={() => runMutation(() => completeAction(action.id))}
                            onSnooze={() => runMutation(() => snoozeAction(action.id, addDays(2), "Snoozed from quick triage."))}
                          />
                        ))}
                      </div>
                    </section>
                  ))}

                {lanes.length === 0 || (view !== "attention" && lanes.filter((lane) => lane.id === view).length === 0) ? (
                  <section className="actions-empty-state">
                    <h2>Nothing urgent needs your attention right now.</h2>
                    <p>Your action list is clean. New items will appear here when they need a decision.</p>
                  </section>
                ) : null}
              </>
            )}
          </main>

          <ActionInspector
            action={selectedAction}
            people={people}
            pending={isPending}
            suggestion={aiSuggestion && aiSuggestion.actionId === selectedAction?.id ? aiSuggestion.value : null}
            suggestionPending={isSuggesting}
            onStatus={(status) => updateSelected({ status })}
            onPriority={(priority) => updateSelected({ priority })}
            onDueDate={(value) => updateSelected({ dueAt: value || null })}
            onFollowUpDate={(value) => updateSelected({ followUpAt: value || null })}
            onPerson={(personId) => {
              if (!selectedAction) return;
              runMutation(() => linkActionPerson(selectedAction.id, personId));
            }}
            onSuggest={requestSuggestion}
            onApplySuggestion={applySuggestion}
          />
        </div>
      </div>
    </>
  );
}
