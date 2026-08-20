"use client";

/**
 * app/(app)/actions/actions-workspace.tsx
 *
 * The Actions surface as a Kanban board: five workflow columns over the
 * existing action statuses, drag-and-drop between columns with an accessible
 * move menu as the non-drag path, quick capture that never leaves the page,
 * and a duplicate review strip fed by the generation-time semantic flags.
 *
 * Moves are optimistic: the card shifts immediately, the server action runs in
 * a transition, and a failure reverts the card and surfaces a calm error.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
  decideAction,
  mergeDuplicateActions,
  clearReviewQueue,
} from "./actions";
import type { PersonLinkOption } from "@/components/refinement/person-link-control";
import { consumeActionDraft } from "./action-draft";
import {
  BOARD_COLUMNS,
  DONE_PAGE_SIZE,
  buildDuplicateGroups,
  groupActionsIntoColumns,
  isOverdue,
  partitionDoneCards,
  statusForDrop,
  type BoardColumnId,
  type DuplicateGroup,
} from "./board-model";

const PRIORITY_LABELS: Record<ActionPriority, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
  low: "Low",
};

function formatDate(value: string | null): string {
  if (!value) return "";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(new Date(year!, month! - 1, day));
}

function addDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function personName(
  people: readonly PersonLinkOption[],
  personId: string | null,
): string | null {
  if (!personId) return null;
  return people.find((person) => person.id === personId)?.displayName ?? null;
}

// ---------------------------------------------------------------------------
// Move menu — the accessible, touch-friendly alternative to drag-and-drop.
// ---------------------------------------------------------------------------

function MoveMenu({
  action,
  pending,
  onMove,
  onComplete,
  onSnooze,
  onDismiss,
}: {
  readonly action: SuggestedActionView;
  readonly pending: boolean;
  readonly onMove: (status: ActionStatus) => void;
  readonly onComplete: () => void;
  readonly onSnooze: () => void;
  readonly onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const currentColumn = BOARD_COLUMNS.find((column) =>
    column.statuses.includes(action.status),
  );

  function choose(run: () => void) {
    setOpen(false);
    run();
  }

  return (
    <div className="board-card__menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="board-card__menu-trigger"
        aria-label={`Move or update: ${action.title}`}
        aria-expanded={open}
        disabled={pending}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {open ? (
        <div className="board-card__menu-panel" role="menu" aria-label="Move action">
          <p className="board-card__menu-label">Move to</p>
          {BOARD_COLUMNS.filter(
            (column) => column.id !== currentColumn?.id && column.id !== "to_approve",
          ).map((column) => (
            <button
              key={column.id}
              type="button"
              role="menuitem"
              onClick={() =>
                choose(() =>
                  column.id === "done" ? onComplete() : onMove(column.dropStatus),
                )
              }
            >
              {column.id === "done" ? "Done (complete)" : column.title}
            </button>
          ))}
          <p className="board-card__menu-label">More</p>
          <button type="button" role="menuitem" onClick={() => choose(onSnooze)}>
            Snooze 2 days
          </button>
          <button
            type="button"
            role="menuitem"
            className="board-card__menu-danger"
            onClick={() => choose(onDismiss)}
          >
            Not an action
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function BoardCard({
  action,
  people,
  pending,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
  onApprove,
  onDismiss,
  onComplete,
  onSnooze,
}: {
  readonly action: SuggestedActionView;
  readonly people: readonly PersonLinkOption[];
  readonly pending: boolean;
  readonly dragging: boolean;
  readonly onDragStart: (event: React.DragEvent) => void;
  readonly onDragEnd: () => void;
  readonly onMove: (status: ActionStatus) => void;
  readonly onApprove: () => void;
  readonly onDismiss: () => void;
  readonly onComplete: () => void;
  readonly onSnooze: () => void;
}) {
  const overdue = isOverdue(action);
  const linkedPerson = personName(people, action.personId);
  const showPriority = action.priority === "critical" || action.priority === "high";
  const finished = action.status === "completed" || action.status === "cancelled";

  return (
    <article
      className={[
        "board-card",
        dragging ? "board-card--dragging" : "",
        overdue ? "board-card--overdue" : "",
        finished ? "board-card--finished" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      draggable={!finished}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <Link className="board-card__body" href={`/actions/${action.id}`}>
        <span className="board-card__title">{action.title}</span>
        {(overdue || action.dueAt || action.followUpAt || linkedPerson || showPriority ||
          action.status === "follow_up" || action.status === "cancelled" ||
          action.references.length > 0 || action.duplicateGroupId) ? (
          <span className="board-card__meta">
            {overdue ? (
              <span className="board-card__chip board-card__chip--risk">
                Overdue {formatDate(action.dueAt)}
              </span>
            ) : action.dueAt ? (
              <span className="board-card__chip">Due {formatDate(action.dueAt)}</span>
            ) : action.followUpAt ? (
              <span className="board-card__chip">
                Follow up {formatDate(action.followUpAt)}
              </span>
            ) : null}
            {showPriority ? (
              <span
                className={`board-card__chip ${action.priority === "critical" ? "board-card__chip--risk" : "board-card__chip--warn"}`}
              >
                {PRIORITY_LABELS[action.priority]}
              </span>
            ) : null}
            {action.status === "follow_up" ? (
              <span className="board-card__chip">Follow-up</span>
            ) : null}
            {action.status === "cancelled" ? (
              <span className="board-card__chip">Dismissed</span>
            ) : null}
            {linkedPerson ? (
              <span className="board-card__chip">{linkedPerson}</span>
            ) : null}
            {action.references.length > 0 ? (
              <span className="board-card__chip board-card__chip--mono">
                {action.references.length} source
                {action.references.length === 1 ? "" : "s"}
              </span>
            ) : null}
            {action.duplicateGroupId && !finished ? (
              <span className="board-card__chip board-card__chip--warn">
                Possible duplicate
              </span>
            ) : null}
          </span>
        ) : null}
      </Link>
      {!finished ? (
        <div className="board-card__actions">
          {action.status === "inbox" ? (
            <>
              <button
                type="button"
                className="board-card__approve"
                disabled={pending}
                onClick={onApprove}
              >
                Approve
              </button>
              <button
                type="button"
                className="board-card__dismiss"
                disabled={pending}
                onClick={onDismiss}
              >
                Dismiss
              </button>
            </>
          ) : null}
          <MoveMenu
            action={action}
            pending={pending}
            onMove={onMove}
            onComplete={onComplete}
            onSnooze={onSnooze}
            onDismiss={onDismiss}
          />
        </div>
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Duplicate review
// ---------------------------------------------------------------------------

function DuplicateReview({
  groups,
  pending,
  onMerge,
  onKeepSeparate,
}: {
  readonly groups: readonly DuplicateGroup[];
  readonly pending: boolean;
  readonly onMerge: (group: DuplicateGroup, approve: boolean) => void;
  readonly onKeepSeparate: (group: DuplicateGroup) => void;
}) {
  return (
    <div className="duplicate-strip__list">
      {groups.map((group) => (
        <section className="duplicate-strip__group" key={group.id}>
          <div className="duplicate-strip__summary">
            <p className="duplicate-strip__title">
              Keep <strong>{group.primary.title}</strong>
            </p>
            <p className="duplicate-strip__detail">
              {group.duplicates.length === 1
                ? `1 similar item: ${group.duplicates[0]?.title}.`
                : `${group.duplicates.length} similar items, including ${group.duplicates[0]?.title}.`}{" "}
              {group.reason}
            </p>
          </div>
          <div className="duplicate-strip__commands">
            {group.primary.status === "inbox" ? (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={pending}
                onClick={() => onMerge(group, true)}
              >
                Merge and approve
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={pending}
              onClick={() => onMerge(group, false)}
            >
              Merge
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={pending}
              onClick={() => onKeepSeparate(group)}
            >
              Keep separate
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export function ActionsWorkspace({
  actions,
  people,
}: {
  readonly actions: readonly SuggestedActionView[];
  readonly people: readonly PersonLinkOption[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [captureTitle, setCaptureTitle] = useState("");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureDue, setCaptureDue] = useState("");
  const [capturePriority, setCapturePriority] = useState<ActionPriority>("normal");
  const [captureNote, setCaptureNote] = useState("");
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [dismissedGroups, setDismissedGroups] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<BoardColumnId | null>(null);
  const [confirmClearQueue, setConfirmClearQueue] = useState(false);
  const [olderDoneVisible, setOlderDoneVisible] = useState(0);
  const [overrides, setOverrides] = useState<Map<string, ActionStatus>>(new Map());
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const draft = consumeActionDraft(window.sessionStorage);
    if (!draft) return;
    const timer = window.setTimeout(() => {
      setCaptureTitle(draft.title);
      setCaptureNote(draft.note);
      setCaptureOpen(Boolean(draft.note));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Drop an optimistic override once the server round-trip is reflected in
  // props (state adjusted during render, per the React "you might not need an
  // effect" guidance, so there is no extra committed render).
  const [prevActions, setPrevActions] = useState(actions);
  if (prevActions !== actions) {
    setPrevActions(actions);
    if (overrides.size > 0) {
      const next = new Map(overrides);
      for (const action of actions) {
        if (next.get(action.id) === action.status) next.delete(action.id);
      }
      if (next.size !== overrides.size) setOverrides(next);
    }
  }

  const effectiveActions = useMemo(
    () =>
      actions.map((action) => {
        const override = overrides.get(action.id);
        return override && override !== action.status
          ? { ...action, status: override }
          : action;
      }),
    [actions, overrides],
  );

  const q = searchQuery.toLowerCase().trim();
  const visibleActions = useMemo(() => {
    if (!q) return effectiveActions;
    return effectiveActions.filter((action) => {
      const linkedPerson = personName(people, action.personId) ?? "";
      return [
        action.title,
        action.description ?? "",
        action.rationale ?? "",
        linkedPerson,
        action.topics.join(" "),
      ].some((value) => value.toLowerCase().includes(q));
    });
  }, [effectiveActions, people, q]);

  const groups = useMemo(() => groupActionsIntoColumns(visibleActions), [visibleActions]);
  const doneSplit = useMemo(() => partitionDoneCards(groups.done), [groups.done]);
  const duplicateGroups = useMemo(
    () =>
      buildDuplicateGroups(effectiveActions).filter(
        (group) => !dismissedGroups.includes(group.id),
      ),
    [effectiveActions, dismissedGroups],
  );

  const boardIsEmpty = effectiveActions.length === 0;

  function runMutation(
    work: () => Promise<{ ok: boolean; error?: string }>,
    revert?: () => void,
  ) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        revert?.();
        setError(result.error ?? "That change could not be saved. Try again.");
      } else {
        router.refresh();
      }
    });
  }

  function moveAction(actionId: string, status: ActionStatus) {
    const before = effectiveActions.find((action) => action.id === actionId)?.status;
    if (!before || before === status) return;
    setOverrides((current) => new Map(current).set(actionId, status));
    runMutation(
      () => updateAction(actionId, { status }),
      () =>
        setOverrides((current) => {
          const next = new Map(current);
          next.delete(actionId);
          return next;
        }),
    );
  }

  function complete(actionId: string) {
    setOverrides((current) => new Map(current).set(actionId, "completed"));
    runMutation(
      () => completeAction(actionId),
      () =>
        setOverrides((current) => {
          const next = new Map(current);
          next.delete(actionId);
          return next;
        }),
    );
  }

  function approve(actionId: string) {
    setOverrides((current) => new Map(current).set(actionId, "planned"));
    runMutation(() => decideAction(actionId, "approve"));
  }

  function dismiss(actionId: string) {
    setOverrides((current) => new Map(current).set(actionId, "cancelled"));
    runMutation(() => decideAction(actionId, "dismiss"));
  }

  function snooze(actionId: string) {
    runMutation(() => snoozeAction(actionId, addDays(2), "Snoozed from the board."));
  }

  function clearQueue() {
    setConfirmClearQueue(false);
    const inboxIds = effectiveActions
      .filter((action) => action.status === "inbox")
      .map((action) => action.id);
    if (inboxIds.length === 0) return;
    setOverrides((current) => {
      const next = new Map(current);
      for (const id of inboxIds) next.set(id, "cancelled");
      return next;
    });
    runMutation(
      () => clearReviewQueue(),
      () =>
        setOverrides((current) => {
          const next = new Map(current);
          for (const id of inboxIds) next.delete(id);
          return next;
        }),
    );
  }

  function submitQuickAction(event: React.FormEvent) {
    event.preventDefault();
    const title = captureTitle.trim();
    if (!title) return;
    runMutation(async () => {
      const result = await createAction({
        title,
        status: "planned",
        description: captureNote.trim() || undefined,
        dueAt: captureDue || null,
        priority: capturePriority,
      });
      if (result.ok) {
        setCaptureTitle("");
        setCaptureNote("");
        setCaptureDue("");
        setCapturePriority("normal");
        setCaptureOpen(false);
        setJustAdded(title);
      }
      return result;
    });
  }

  // The confirmation is transient; the card itself is the durable feedback.
  useEffect(() => {
    if (!justAdded) return;
    const timer = setTimeout(() => setJustAdded(null), 4000);
    return () => clearTimeout(timer);
  }, [justAdded]);

  function handleDrop(columnId: BoardColumnId, event: React.DragEvent) {
    event.preventDefault();
    setDropTarget(null);
    const actionId = event.dataTransfer.getData("text/paylo-action-id");
    setDraggingId(null);
    if (!actionId) return;
    if (columnId === "done") {
      complete(actionId);
      return;
    }
    if (columnId === "to_approve") return; // Nothing re-enters review.
    moveAction(actionId, statusForDrop(columnId));
  }

  return (
    <div className="actions-board">
      <header className="page-head actions-board__head">
        <div>
          <p className="eyebrow">Actions</p>
          <h1 className="page-head__title">Your commitments, in one view</h1>
          <p className="page-head__lead">
            Review suggestions, move work through the board, and keep only what
            deserves attention.
          </p>
        </div>
        <form className="board-capture" onSubmit={submitQuickAction}>
          <label htmlFor="quick-action-title" className="board-capture__label">
            Add a quick action
          </label>
          <div className="board-capture__row">
            <input
              id="quick-action-title"
              className="input"
              value={captureTitle}
              onChange={(event) => setCaptureTitle(event.target.value)}
              placeholder="What needs doing?"
              disabled={isPending}
            />
            <button
              type="submit"
              className="btn btn--primary"
              disabled={isPending || !captureTitle.trim()}
            >
              Add
            </button>
          </div>
          <button
            type="button"
            className="board-capture__more"
            aria-expanded={captureOpen}
            onClick={() => setCaptureOpen((value) => !value)}
          >
            {captureOpen ? "Hide details" : "Add details"}
          </button>
          {captureOpen ? (
            <div className="board-capture__details">
              <label>
                <span>Note</span>
                <input
                  className="input"
                  value={captureNote}
                  onChange={(event) => setCaptureNote(event.target.value)}
                  placeholder="Context worth keeping"
                />
              </label>
              <label>
                <span>Due date</span>
                <input
                  className="input"
                  type="date"
                  value={captureDue}
                  onChange={(event) => setCaptureDue(event.target.value)}
                />
              </label>
              <label>
                <span>Priority</span>
                <select
                  className="input"
                  value={capturePriority}
                  onChange={(event) =>
                    setCapturePriority(event.target.value as ActionPriority)
                  }
                >
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          {justAdded ? (
            <p className="form-message form-message--ok" role="status">
              Added to Planned: {justAdded}
            </p>
          ) : null}
        </form>
      </header>

      <div className="actions-board__toolbar">
        <div className="board-search">
          <label htmlFor="actions-search" className="board-search__label">
            Search
          </label>
          <input
            id="actions-search"
            className="input"
            type="search"
            value={searchQuery}
            placeholder="Search actions, people, or topics"
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
        {duplicateGroups.length > 0 ? (
          <button
            type="button"
            className="duplicate-strip__toggle"
            aria-expanded={showDuplicates}
            onClick={() => setShowDuplicates((value) => !value)}
          >
            {duplicateGroups.length} possible duplicate
            {duplicateGroups.length === 1 ? "" : "s"} to review
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="alert alert--risk" role="alert">
          {error}
        </p>
      ) : null}

      {showDuplicates && duplicateGroups.length > 0 ? (
        <section className="duplicate-strip" aria-label="Possible duplicates">
          <DuplicateReview
            groups={duplicateGroups}
            pending={isPending}
            onMerge={(group, approvePrimary) =>
              runMutation(() =>
                mergeDuplicateActions({
                  primaryActionId: group.primary.id,
                  duplicateActionIds: group.duplicates.map((item) => item.id),
                  approvePrimary,
                  reason: group.reason,
                }),
              )
            }
            onKeepSeparate={(group) =>
              setDismissedGroups((current) => [...current, group.id])
            }
          />
        </section>
      ) : null}

      {boardIsEmpty ? (
        <section className="empty actions-board__empty">
          <p className="empty__title">Nothing to track yet</p>
          <p className="empty__body">
            Add your first action above, or connect a source and Pilot will
            suggest the commitments it finds.
          </p>
        </section>
      ) : (
        <div className="board" role="list" aria-label="Action board">
          {BOARD_COLUMNS.map((column) => {
            const olderShown =
              column.id === "done"
                ? doneSplit.older.slice(0, olderDoneVisible)
                : [];
            const olderRemaining =
              column.id === "done"
                ? doneSplit.older.length - olderShown.length
                : 0;
            const items =
              column.id === "done"
                ? [...doneSplit.recent, ...olderShown]
                : groups[column.id];
            return (
              <section
                key={column.id}
                role="listitem"
                aria-label={`${column.title}, ${items.length} item${items.length === 1 ? "" : "s"}`}
                className={[
                  "board-col",
                  dropTarget === column.id ? "board-col--drop" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onDragOver={(event) => {
                  if (column.id === "to_approve") return;
                  event.preventDefault();
                  setDropTarget(column.id);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                    setDropTarget((current) =>
                      current === column.id ? null : current,
                    );
                  }
                }}
                onDrop={(event) => handleDrop(column.id, event)}
              >
                <header className="board-col__head">
                  <h2 className="board-col__title">{column.title}</h2>
                  <span className="board-col__count">{items.length}</span>
                </header>
                {column.id === "to_approve" && items.length > 0 ? (
                  <div className="board-col__tools">
                    {confirmClearQueue ? (
                      <>
                        <span className="board-col__tools-note">
                          Dismiss all {items.length}?
                        </span>
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          disabled={isPending}
                          onClick={clearQueue}
                        >
                          Dismiss all
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => setConfirmClearQueue(false)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="board-col__clear"
                        disabled={isPending}
                        onClick={() => setConfirmClearQueue(true)}
                      >
                        Clear review queue
                      </button>
                    )}
                  </div>
                ) : null}
                <div className="board-col__list">
                  {items.length === 0 ? (
                    <p className="board-col__empty">{column.hint}</p>
                  ) : (
                    items.map((action) => (
                      <BoardCard
                        key={action.id}
                        action={action}
                        people={people}
                        pending={isPending}
                        dragging={draggingId === action.id}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(
                            "text/paylo-action-id",
                            action.id,
                          );
                          event.dataTransfer.effectAllowed = "move";
                          setDraggingId(action.id);
                        }}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setDropTarget(null);
                        }}
                        onMove={(status) => moveAction(action.id, status)}
                        onApprove={() => approve(action.id)}
                        onDismiss={() => dismiss(action.id)}
                        onComplete={() => complete(action.id)}
                        onSnooze={() => snooze(action.id)}
                      />
                    ))
                  )}
                  {column.id === "done" && olderRemaining > 0 ? (
                    <button
                      type="button"
                      className="board-col__more"
                      onClick={() =>
                        setOlderDoneVisible((count) => count + DONE_PAGE_SIZE)
                      }
                    >
                      Show older ({olderRemaining})
                    </button>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
