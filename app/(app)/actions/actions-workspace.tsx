"use client";

import { useMemo, useState, useEffect, useTransition } from "react";
import type { SuggestedActionView, ActionStatus, ActionPriority } from "@/modules/action-extraction/server";
import { ActionControls } from "./action-controls";
import {
  PersonLinkControl,
  type PersonLinkOption,
} from "@/components/refinement/person-link-control";
import { RefinementActions } from "@/components/refinement/refinement-actions";
import { createAction, updateAction, snoozeAction, completeAction, deleteAction, linkActionPerson } from "./actions";

type LiveView =
  | "inbox"
  | "planned"
  | "in_progress"
  | "waiting"
  | "follow_ups"
  | "deadlines"
  | "topics"
  | "people"
  | "completed"
  | "all";

const STATUS_META: Record<
  ActionStatus,
  { label: string; tone: "ok" | "info" | "warn" | "risk" | "neutral" }
> = {
  inbox: { label: "Inbox", tone: "warn" },
  planned: { label: "Planned", tone: "info" },
  in_progress: { label: "In Progress", tone: "ok" },
  waiting: { label: "Waiting On", tone: "neutral" },
  follow_up: { label: "Follow-up", tone: "warn" },
  completed: { label: "Completed", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

function confidenceFor(action: SuggestedActionView): number | null {
  const values = action.references
    .map((reference) => reference.confidence)
    .filter((confidence): confidence is number => typeof confidence === "number");
  return values.length > 0 ? Math.max(...values) : null;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function sourceLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function ActionRow({
  action,
  selected,
  onSelect,
}: {
  action: SuggestedActionView;
  selected: boolean;
  onSelect: () => void;
}) {
  const confidence = confidenceFor(action);
  const status = STATUS_META[action.status] ?? {
    label: action.status,
    tone: "neutral" as const,
  };

  // Compute a live, high-context attention light based on status, priority and due dates
  let attentionTone: "ok" | "info" | "warn" | "risk" | "neutral" = status.tone;
  const isOverdue = action.dueAt && new Date(action.dueAt) < new Date() && action.status !== "completed" && action.status !== "cancelled";

  if (action.status !== "completed" && action.status !== "cancelled") {
    if (isOverdue) {
      attentionTone = "risk";
    } else if (action.priority === "critical") {
      attentionTone = "risk";
    } else if (action.priority === "high") {
      attentionTone = "warn";
    } else if (action.status === "in_progress") {
      attentionTone = "ok";
    } else if (action.status === "waiting") {
      attentionTone = "neutral";
    }
  }

  const priorityLabel = action.priority ? action.priority.toUpperCase() : "NORMAL";

  return (
    <article className={`action-row${selected ? " action-row--selected" : ""}`}>
      <span
        className={`action-row__attention action-row__attention--${attentionTone}`}
        aria-hidden="true"
      />
      <button type="button" className="action-row__select" onClick={onSelect}>
        <span className="action-row__title" style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span>{action.title}</span>
          {action.priority && action.priority !== "normal" && (
            <span className={`status status--${action.priority === "critical" ? "risk" : "warn"}`} style={{ fontSize: "10px", padding: "1px 6px", textTransform: "uppercase" }}>
              {action.priority}
            </span>
          )}
          {isOverdue && (
            <span className="status status--risk" style={{ fontSize: "10px", padding: "1px 6px", textTransform: "uppercase" }}>
              Overdue
            </span>
          )}
        </span>
        <span className="action-row__context">
          <span>{priorityLabel}</span>
          <span>{status.label}</span>
          {action.dueAt ? <span style={{ color: isOverdue ? "var(--colour-danger)" : "inherit" }}>Due {formatDate(action.dueAt)}</span> : null}
          {action.followUpAt ? <span>Follow-up {formatDate(action.followUpAt)}</span> : null}
          {action.references.length > 0 ? (
            <span>
              {action.references.length}{" "}
              {action.references.length === 1 ? "source" : "sources"}
            </span>
          ) : null}
          {confidence !== null ? (
            <span>{Math.round(confidence * 100)}% confidence</span>
          ) : null}
        </span>
        {action.rationale ? (
          <span className="action-row__rationale">{action.rationale}</span>
        ) : null}
      </button>
      <span className={`status status--${status.tone}`}>{status.label}</span>
    </article>
  );
}

function ActionInspector({
  action,
  people,
  onRefresh,
}: {
  action: SuggestedActionView | null;
  people: readonly PersonLinkOption[];
  onRefresh?: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [isDeletePending, startDeleteTransition] = useTransition();
  const [isSnoozePending, startSnoozeTransition] = useTransition();
  const [isCompletePending, startCompleteTransition] = useTransition();

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form inputs
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<ActionPriority>("normal");
  const [status, setStatus] = useState<ActionStatus>("inbox");
  const [dueAt, setDueAt] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [newTopic, setNewTopic] = useState("");

  // Snooze inputs
  const [snoozeUntil, setSnoozeUntil] = useState("");
  const [snoozeReason, setSnoozeReason] = useState("");

  // Complete feedback
  const [completionFeedback, setCompletionFeedback] = useState("");

  // Sync state with selected action
  useEffect(() => {
    if (action) {
      setTitle(action.title);
      setDescription(action.description ?? "");
      setPriority(action.priority ?? "normal");
      setStatus(action.status ?? "inbox");
      setDueAt(action.dueAt ? action.dueAt.substring(0, 10) : "");
      setFollowUpAt(action.followUpAt ? action.followUpAt.substring(0, 10) : "");
      setTopics(action.topics || []);
      setNewTopic("");
      setSnoozeUntil("");
      setSnoozeReason("");
      setCompletionFeedback("");
      setError(null);
      setSuccess(false);
    }
  }, [action]);

  if (!action) {
    return (
      <aside className="actions-inspector">
        <div className="actions-inspector__empty">
          <p className="eyebrow">Action context</p>
          <h2>Select an action</h2>
          <p>
            Its rationale, details, people, sources, and full lifecycle controls
            will appear here.
          </p>
        </div>
      </aside>
    );
  }

  const activeAction = action;

  function handleAddTopic(e: React.FormEvent) {
    e.preventDefault();
    const clean = newTopic.trim();
    if (clean && !topics.includes(clean)) {
      setTopics([...topics, clean]);
      setNewTopic("");
    }
  }

  function handleRemoveTopic(tag: string) {
    setTopics(topics.filter((t) => t !== tag));
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    startTransition(async () => {
      const res = await updateAction(activeAction.id, {
        title,
        description: description || null,
        priority,
        status,
        dueAt: dueAt || null,
        followUpAt: followUpAt || null,
        topics,
      });

      if (!res.ok) {
        setError(res.error ?? "Failed to save changes.");
      } else {
        setSuccess(true);
        if (onRefresh) onRefresh();
      }
    });
  }

  function handleSnooze(e: React.FormEvent) {
    e.preventDefault();
    if (!snoozeUntil) {
      setError("Please select a date to snooze until.");
      return;
    }
    setError(null);
    setSuccess(false);

    startSnoozeTransition(async () => {
      const res = await snoozeAction(activeAction.id, snoozeUntil, snoozeReason);
      if (!res.ok) {
        setError(res.error ?? "Failed to snooze action.");
      } else {
        setSuccess(true);
        setSnoozeUntil("");
        setSnoozeReason("");
        if (onRefresh) onRefresh();
      }
    });
  }

  function handleUn_snooze() {
    setError(null);
    setSuccess(false);

    startSnoozeTransition(async () => {
      const res = await snoozeAction(activeAction.id, null);
      if (!res.ok) {
        setError(res.error ?? "Failed to clear snooze.");
      } else {
        setSuccess(true);
        if (onRefresh) onRefresh();
      }
    });
  }

  function handleComplete(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    startCompleteTransition(async () => {
      const res = await completeAction(activeAction.id, completionFeedback);
      if (!res.ok) {
        setError(res.error ?? "Failed to complete action.");
      } else {
        setSuccess(true);
        setCompletionFeedback("");
        if (onRefresh) onRefresh();
      }
    });
  }

  function handleDelete() {
    if (!window.confirm("Are you sure you want to permanently delete this action?")) return;
    setError(null);
    setSuccess(false);

    startDeleteTransition(async () => {
      const res = await deleteAction(activeAction.id);
      if (!res.ok) {
        setError(res.error ?? "Failed to delete action.");
      } else {
        setSuccess(true);
        if (onRefresh) onRefresh();
      }
    });
  }

  const isSnoozed = activeAction.snoozedUntil && new Date(activeAction.snoozedUntil) > new Date();

  return (
    <aside className="actions-inspector" aria-label="Selected action details" style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)", paddingBottom: "var(--space-xl)" }}>
      <div className="actions-inspector__head" style={{ borderBottom: "1px solid var(--colour-border)", padding: "var(--space-lg)" }}>
        <p className="eyebrow">Action Details</p>
        <h2 style={{ fontSize: "var(--text-h3)", fontWeight: 600, color: "var(--colour-text-primary)" }}>{activeAction.title}</h2>
        <div style={{ marginTop: "var(--space-sm)" }}>
          <ActionControls actionId={activeAction.id} status={activeAction.status} onStatusChange={() => { if (onRefresh) onRefresh(); }} />
        </div>
      </div>

      <div style={{ padding: "0 var(--space-lg)" }}>
        {error ? <p className="form-message form-message--error" style={{ margin: "var(--space-xs) 0" }}>{error}</p> : null}
        {success ? <p className="form-message form-message--ok" style={{ margin: "var(--space-xs) 0" }}>Changes saved successfully.</p> : null}
      </div>

      {isSnoozed && (
        <div className="alert alert--accent" style={{ margin: "0 var(--space-lg)", padding: "var(--space-md)" }}>
          <h4 style={{ fontWeight: "bold", fontSize: "13px" }}>Action Snoozed</h4>
          <p style={{ fontSize: "12px", margin: "var(--space-xs) 0" }}>
            This commitment is snoozed until <strong>{formatDate(activeAction.snoozedUntil!)}</strong>.
          </p>
          {activeAction.snoozeMetadata?.last_snooze?.reason && (
            <p style={{ fontSize: "11px", fontStyle: "italic", color: "var(--colour-text-secondary)" }}>
              &ldquo;{activeAction.snoozeMetadata.last_snooze.reason}&rdquo;
            </p>
          )}
          <button
            type="button"
            onClick={handleUn_snooze}
            disabled={isSnoozePending}
            className="btn btn--secondary btn--sm"
            style={{ marginTop: "var(--space-xs)" }}
          >
            {isSnoozePending ? "Clearing..." : "Un-snooze action"}
          </button>
        </div>
      )}

      <form onSubmit={handleSave} className="stack" style={{ gap: "var(--space-md)", padding: "0 var(--space-lg)" }}>
        <div className="field">
          <label htmlFor="inspector-title" className="field__label">Title</label>
          <input
            id="inspector-title"
            type="text"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isPending}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="inspector-desc" className="field__label">Description</label>
          <textarea
            id="inspector-desc"
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isPending}
            rows={3}
            placeholder="Add context, sub-tasks, or expectations…"
            style={{ resize: "vertical", fontFamily: "inherit" }}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-md)" }}>
          <div className="field">
            <label htmlFor="inspector-priority" className="field__label">Priority</label>
            <select
              id="inspector-priority"
              className="input"
              value={priority}
              onChange={(e) => setPriority(e.target.value as ActionPriority)}
              disabled={isPending}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="inspector-status" className="field__label">Status</label>
            <select
              id="inspector-status"
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as ActionStatus)}
              disabled={isPending}
            >
              <option value="inbox">Inbox</option>
              <option value="planned">Planned</option>
              <option value="in_progress">In Progress</option>
              <option value="waiting">Waiting On</option>
              <option value="follow_up">Follow-up</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-md)" }}>
          <div className="field">
            <label htmlFor="inspector-due" className="field__label">Due Date</label>
            <input
              id="inspector-due"
              type="date"
              className="input"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="field">
            <label htmlFor="inspector-followup" className="field__label">Follow-up Date</label>
            <input
              id="inspector-followup"
              type="date"
              className="input"
              value={followUpAt}
              onChange={(e) => setFollowUpAt(e.target.value)}
              disabled={isPending}
            />
          </div>
        </div>

        <div className="field">
          <label className="field__label">Topics & Strategic Areas</label>
          <div className="stack" style={{ gap: "var(--space-xs)" }}>
            {topics.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "4px" }}>
                {topics.map((tag) => (
                  <span key={tag} className="chip chip--accent" style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 8px" }}>
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTopic(tag)}
                      disabled={isPending}
                      style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", fontSize: "12px", fontWeight: "bold" }}
                      title={`Remove topic ${tag}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: "11px", color: "var(--colour-text-muted)", margin: "2px 0" }}>No topics linked.</p>
            )}
            
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                type="text"
                className="input"
                placeholder="e.g. Q3 Hiring, Security"
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                disabled={isPending}
                style={{ flex: 1, padding: "4px 8px", fontSize: "12px" }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const clean = newTopic.trim();
                    if (clean && !topics.includes(clean)) {
                      setTopics([...topics, clean]);
                      setNewTopic("");
                    }
                  }
                }}
              />
              <button
                type="button"
                className="btn btn--secondary"
                style={{ fontSize: "12px", padding: "4px 10px" }}
                disabled={isPending || !newTopic.trim()}
                onClick={(e) => {
                  const clean = newTopic.trim();
                  if (clean && !topics.includes(clean)) {
                    setTopics([...topics, clean]);
                    setNewTopic("");
                  }
                }}
              >
                + Add
              </button>
            </div>
          </div>
        </div>

        <button type="submit" className="btn btn--primary" disabled={isPending} style={{ width: "100%", marginTop: "var(--space-xs)" }}>
          {isPending ? "Saving..." : "Save Changes"}
        </button>
      </form>

      {/* Linked People Section */}
      <section className="actions-inspector__section" style={{ borderTop: "1px solid var(--colour-border)" }}>
        <p className="actions-inspector__label">Associated Person</p>
        <div style={{ marginTop: "var(--space-sm)" }}>
          <PersonLinkControl
            key={activeAction.id}
            targetId={activeAction.id}
            people={people}
            initialPersonId={activeAction.personId}
            onChange={async (personId) => {
              const res = await linkActionPerson(activeAction.id, personId);
              if (res.ok && onRefresh) {
                onRefresh();
              }
              return res;
            }}
          />
        </div>
      </section>

      {/* Snooze Action Section */}
      {!isSnoozed && activeAction.status !== "completed" && activeAction.status !== "cancelled" && (
        <section className="actions-inspector__section" style={{ borderTop: "1px solid var(--colour-border)" }}>
          <p className="actions-inspector__label">Snooze Commitment</p>
          <form onSubmit={handleSnooze} className="stack" style={{ gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
            <div className="field">
              <label htmlFor="snooze-date" className="field__label">Snooze until</label>
              <input
                id="snooze-date"
                type="date"
                className="input"
                value={snoozeUntil}
                onChange={(e) => setSnoozeUntil(e.target.value)}
                disabled={isSnoozePending}
                required
              />
              {/* Quick snooze triggers */}
              <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  style={{ fontSize: "11px", padding: "2px 6px" }}
                  disabled={isSnoozePending}
                  onClick={() => {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    setSnoozeUntil(tomorrow.toISOString().substring(0, 10));
                  }}
                >
                  +1 Day
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  style={{ fontSize: "11px", padding: "2px 6px" }}
                  disabled={isSnoozePending}
                  onClick={() => {
                    const nextWeek = new Date();
                    nextWeek.setDate(nextWeek.getDate() + 7);
                    setSnoozeUntil(nextWeek.toISOString().substring(0, 10));
                  }}
                >
                  +1 Week
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="snooze-reason" className="field__label">Snooze Reason</label>
              <input
                id="snooze-reason"
                type="text"
                className="input"
                placeholder="e.g. Waiting on partner feedback..."
                value={snoozeReason}
                onChange={(e) => setSnoozeReason(e.target.value)}
                disabled={isSnoozePending}
              />
            </div>
            <button type="submit" className="btn btn--secondary" disabled={isSnoozePending || !snoozeUntil}>
              {isSnoozePending ? "Snoozing..." : "Snooze Action"}
            </button>
          </form>
        </section>
      )}

      {/* Complete with Feedback Section */}
      {activeAction.status !== "completed" && (
        <section className="actions-inspector__section" style={{ borderTop: "1px solid var(--colour-border)" }}>
          <p className="actions-inspector__label">Complete Action</p>
          <form onSubmit={handleComplete} className="stack" style={{ gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
            <div className="field">
              <label htmlFor="complete-feedback" className="field__label">Completion Note (Optional)</label>
              <input
                id="complete-feedback"
                type="text"
                className="input"
                placeholder="e.g. Budget signed off"
                value={completionFeedback}
                onChange={(e) => setCompletionFeedback(e.target.value)}
                disabled={isCompletePending}
              />
            </div>
            <button type="submit" className="btn btn--accent-outline" disabled={isCompletePending}>
              {isCompletePending ? "Completing..." : "✓ Mark as Completed"}
            </button>
          </form>
        </section>
      )}

      {/* Danger Zone Section */}
      <section className="actions-inspector__section" style={{ borderTop: "1px solid var(--colour-border)" }}>
        <p className="actions-inspector__label">Danger Zone</p>
        <div style={{ marginTop: "var(--space-sm)" }}>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeletePending}
            className="btn btn--danger"
            style={{ width: "100%", fontSize: "12px" }}
          >
            {isDeletePending ? "Deleting..." : "Permanently Delete Action"}
          </button>
        </div>
      </section>

      {/* Sources list */}
      {activeAction.references && activeAction.references.length > 0 && (
        <section className="actions-inspector__section" style={{ borderTop: "1px solid var(--colour-border)" }}>
          <div className="actions-inspector__section-head">
            <p className="actions-inspector__label">Sources & Traceability</p>
            <span className="mono actions-inspector__confidence" style={{ fontSize: "11px", color: "var(--colour-text-muted)" }}>
              {activeAction.references.length} source{activeAction.references.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="action-source-list" style={{ marginTop: "var(--space-sm)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {activeAction.references.map((reference) => (
              <div className="action-source" key={reference.id} style={{ border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", padding: "var(--space-sm)", background: "var(--colour-surface-secondary)" }}>
                <div className="action-source__head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", fontSize: "11px", color: "var(--colour-text-secondary)", fontFamily: "var(--font-mono)" }}>
                  <span className="source-ref__system">
                    {sourceLabel(reference.sourceSystem)}
                  </span>
                  {reference.itemTimestamp ? (
                    <time dateTime={reference.itemTimestamp}>
                      {formatDate(reference.itemTimestamp)}
                    </time>
                  ) : null}
                </div>
                {reference.excerptOrPointer ? (
                  <p style={{ fontSize: "12px", color: "var(--colour-text-primary)", whiteSpace: "pre-wrap" }}>{reference.excerptOrPointer}</p>
                ) : (
                  <p style={{ fontSize: "12px", color: "var(--colour-text-muted)" }}>Source pointer retained for traceability.</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* RLS private notice */}
      <p className="actions-inspector__audit" style={{ fontSize: "11px", color: "var(--colour-text-muted)", textAlign: "center", margin: "var(--space-sm) var(--space-lg)" }}>
        All edits are private and secure inside your tenant workspace.
      </p>
    </aside>
  );
}

export function ActionsWorkspace({
  actions,
  people,
}: {
  actions: readonly SuggestedActionView[];
  people: readonly PersonLinkOption[];
}) {
  const [view, setView] = useState<LiveView>("inbox");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Fast capture form inputs
  const [captureTitle, setCaptureTitle] = useState("");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [isCapturePending, startCaptureTransition] = useTransition();

  // Dynamically calculate view counts
  const views: { id: LiveView; label: string; count: number }[] = useMemo(() => {
    return [
      { id: "inbox", label: "Inbox", count: actions.filter((a) => a.status === "inbox").length },
      { id: "planned", label: "Planned", count: actions.filter((a) => a.status === "planned").length },
      { id: "in_progress", label: "In Progress", count: actions.filter((a) => a.status === "in_progress").length },
      { id: "waiting", label: "Waiting On", count: actions.filter((a) => a.status === "waiting").length },
      {
        id: "follow_ups",
        label: "Follow-ups",
        count: actions.filter((a) => (a.status === "follow_up" || !!a.followUpAt) && a.status !== "completed" && a.status !== "cancelled").length,
      },
      {
        id: "deadlines",
        label: "Deadlines",
        count: actions.filter((a) => !!a.dueAt && a.status !== "completed" && a.status !== "cancelled").length,
      },
      {
        id: "topics",
        label: "By Topic",
        count: actions.filter((a) => a.status !== "completed" && a.status !== "cancelled").length,
      },
      {
        id: "people",
        label: "By Person",
        count: actions.filter((a) => a.status !== "completed" && a.status !== "cancelled").length,
      },
      {
        id: "completed",
        label: "Completed",
        count: actions.filter((a) => a.status === "completed" || a.status === "cancelled").length,
      },
      { id: "all", label: "All", count: actions.length },
    ];
  }, [actions]);

  // Compute list of actions that fit in the selected view and match the search query
  const visibleActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return actions.filter((action) => {
      let inView = false;
      if (view === "all") {
        inView = true;
      } else if (view === "inbox") {
        inView = action.status === "inbox";
      } else if (view === "planned") {
        inView = action.status === "planned";
      } else if (view === "in_progress") {
        inView = action.status === "in_progress";
      } else if (view === "waiting") {
        inView = action.status === "waiting";
      } else if (view === "follow_ups") {
        inView = (action.status === "follow_up" || !!action.followUpAt) && action.status !== "completed" && action.status !== "cancelled";
      } else if (view === "deadlines") {
        inView = !!action.dueAt && action.status !== "completed" && action.status !== "cancelled";
      } else if (view === "topics" || view === "people") {
        inView = action.status !== "completed" && action.status !== "cancelled";
      } else if (view === "completed") {
        inView = action.status === "completed" || action.status === "cancelled";
      }

      if (!inView) return false;
      if (!q) return true;

      const sourceText = action.references
        .map(
          (reference) =>
            `${reference.sourceSystem} ${reference.excerptOrPointer ?? ""}`,
        )
        .join(" ");
      const topicsText = (action.topics || []).join(" ");
      const personObj = people.find((p) => p.id === action.personId);
      const personText = personObj ? personObj.displayName : "";

      return `${action.title} ${action.description ?? ""} ${action.rationale ?? ""} ${topicsText} ${personText} ${sourceText}`
        .toLowerCase()
        .includes(q);
    });
  }, [actions, query, view, people]);

  // Auto-select the first action in the view if none is selected
  const selected = useMemo(() => {
    if (selectedId) {
      const match = visibleActions.find((a) => a.id === selectedId);
      if (match) return match;
    }
    return visibleActions[0] ?? null;
  }, [visibleActions, selectedId]);

  // Update selectedId if it changes
  useEffect(() => {
    if (selected && selected.id !== selectedId) {
      setSelectedId(selected.id);
    }
  }, [selected, selectedId]);

  // Fast capture submission
  function handleCapture(e: React.FormEvent) {
    e.preventDefault();
    const titleText = captureTitle.trim();
    if (!titleText) return;

    setCaptureError(null);
    startCaptureTransition(async () => {
      const res = await createAction({
        title: titleText,
        status: "inbox",
        priority: "normal",
      });

      if (!res.ok) {
        setCaptureError(res.error ?? "Failed to capture action.");
      } else {
        setCaptureTitle("");
        if (res.data?.id) {
          setSelectedId(res.data.id);
          setView("inbox");
        }
      }
    });
  }

  // Grouped actions for "topics" and "people" views
  const groupedSections = useMemo(() => {
    const list: { name: string; items: SuggestedActionView[] }[] = [];

    if (view === "topics") {
      const topicMap = new Map<string, SuggestedActionView[]>();
      const untagged: SuggestedActionView[] = [];

      visibleActions.forEach((action) => {
        if (action.topics && action.topics.length > 0) {
          action.topics.forEach((topic) => {
            const arr = topicMap.get(topic) || [];
            arr.push(action);
            topicMap.set(topic, arr);
          });
        } else {
          untagged.push(action);
        }
      });

      // Sort alphabetically
      Array.from(topicMap.keys())
        .sort()
        .forEach((topic) => {
          list.push({ name: topic, items: topicMap.get(topic)! });
        });

      if (untagged.length > 0) {
        list.push({ name: "Untagged Commitments", items: untagged });
      }
    } else if (view === "people") {
      const personMap = new Map<string, { name: string; items: SuggestedActionView[] }>();
      const unassigned: SuggestedActionView[] = [];

      visibleActions.forEach((action) => {
        if (action.personId) {
          const pObj = people.find((p) => p.id === action.personId);
          if (pObj) {
            const existing = personMap.get(action.personId) || { name: pObj.displayName, items: [] };
            existing.items.push(action);
            personMap.set(action.personId, existing);
          } else {
            unassigned.push(action);
          }
        } else {
          unassigned.push(action);
        }
      });

      // Sort alphabetically by person name
      Array.from(personMap.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((group) => {
          list.push({ name: group.name, items: group.items });
        });

      if (unassigned.length > 0) {
        list.push({ name: "Unassigned Commitments", items: unassigned });
      }
    }

    return list;
  }, [visibleActions, view, people]);

  const viewHeading = useMemo(() => {
    const matched = views.find((v) => v.id === view);
    return matched ? `${matched.label} Section` : "Action Command Centre";
  }, [view, views]);

  return (
    <>
      <div className="page-head actions-page__head">
        <div>
          <p className="eyebrow">Action Command Centre</p>
          <h1 className="page-head__title">Commitments & accountability</h1>
          <p className="page-head__lead">
            Review and capture what needs follow-through, link topics and people,
            set critical priorities, and establish a bulletproof memory of execution.
          </p>
        </div>
        <span className="status status--ok">Active Command Centre</span>
      </div>

      <section className="action-capture" aria-labelledby="capture-title">
        <div className="action-capture__prompt">
          <span className="action-capture__plus" aria-hidden="true">
            +
          </span>
          <div>
            <h2 id="capture-title">Quick capture commitment</h2>
            <p>Type what you or others committed to. Set dates, priorities and tags in the inspector.</p>
          </div>
        </div>
        <form onSubmit={handleCapture} className="action-capture__control">
          <input
            className="input"
            type="text"
            value={captureTitle}
            onChange={(e) => setCaptureTitle(e.target.value)}
            disabled={isCapturePending}
            aria-describedby="capture-status"
            placeholder="e.g. Align with Maria on Q3 goals by next Thursday…"
            required
          />
          <button className="btn btn--primary" type="submit" disabled={isCapturePending || !captureTitle.trim()}>
            {isCapturePending ? "Capturing..." : "Capture"}
          </button>
        </form>
        {captureError && (
          <p className="form-message form-message--error" style={{ margin: "var(--space-xs) var(--space-lg)" }}>
            {captureError}
          </p>
        )}
        <span id="capture-status" className="action-capture__status mono">
          Manual capture active · entries arrive in your Inbox instantly
        </span>
      </section>

      <div className="actions-shell">
        <nav className="actions-views" aria-label="Action views">
          <p className="actions-views__label">Command Centre Navigation</p>
          {views.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`actions-view${view === item.id ? " actions-view--active" : ""}`}
              aria-pressed={view === item.id}
              onClick={() => setView(item.id)}
            >
              <span>{item.label}</span>
              <span className="actions-view__count mono">{item.count}</span>
            </button>
          ))}
        </nav>

        <section className="actions-working-set" aria-labelledby="working-set-title">
          <div className="actions-working-set__head">
            <div>
              <p className="eyebrow">Working set</p>
              <h2 id="working-set-title">{viewHeading}</h2>
            </div>
            <span className="badge">{visibleActions.length}</span>
          </div>

          <div className="source-search actions-search">
            <span className="source-search__icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.2-3.2" />
              </svg>
            </span>
            <input
              type="search"
              className="input source-search__input"
              placeholder="Search actions, people, topics, or sources…"
              aria-label="Search actions"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <span className="source-search__count mono" aria-live="polite">
              {visibleActions.length} shown
            </span>
          </div>

          <div className="actions-working-set__summary">
            <span>
              {view === "inbox"
                ? "Items captured manually or extracted by AI requiring initial organizing."
                : view === "deadlines"
                  ? "Track active, time-bound deliverables and prevent slips."
                  : view === "follow_ups"
                    ? "Commitments marked for follow-up or check-ins."
                    : "Grounded execution memory scoped to your active tenant."}
            </span>
          </div>

          {visibleActions.length === 0 ? (
            <div className="empty actions-empty">
              <p className="empty__title">
                {query ? "No actions match your search" : "No commitments in this view"}
              </p>
              <p className="empty__body">
                {query
                  ? "Try adjusting your query or filters."
                  : "Captured commitments or AI suggested extractions will list here."}
              </p>
            </div>
          ) : view === "topics" || view === "people" ? (
            <div className="grouped-actions-wrapper" style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
              {groupedSections.map((group) => (
                <div key={group.name} style={{ border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                  <div style={{ background: "var(--colour-surface-secondary)", padding: "var(--space-sm) var(--space-lg)", borderBottom: "1px solid var(--colour-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3 style={{ fontSize: "var(--text-small)", fontWeight: 600, textTransform: "uppercase", color: "var(--colour-text-secondary)", fontFamily: "var(--font-mono)" }}>
                      {group.name}
                    </h3>
                    <span className="badge" style={{ fontSize: "11px", padding: "1px 6px" }}>{group.items.length}</span>
                  </div>
                  <div className="action-list">
                    {group.items.map((action) => (
                      <ActionRow
                        key={`${group.name}-${action.id}`}
                        action={action}
                        selected={action.id === selected?.id}
                        onSelect={() => setSelectedId(action.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="action-list" style={{ border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
              {visibleActions.map((action) => (
                <ActionRow
                  key={action.id}
                  action={action}
                  selected={action.id === selected?.id}
                  onSelect={() => setSelectedId(action.id)}
                />
              ))}
            </div>
          )}
        </section>

        <ActionInspector action={selected} people={people} />
      </div>
    </>
  );
}
