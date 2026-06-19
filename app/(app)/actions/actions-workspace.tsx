"use client";

import { useMemo, useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SuggestedActionView, ActionStatus, ActionPriority } from "@/modules/action-extraction/server";
import { createAction, suggestActionMetadata } from "./actions";
import type { PersonLinkOption } from "@/components/refinement/person-link-control";

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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

// Single Action Row Component
function ActionRow({
  action,
  people,
  onClick,
}: {
  readonly action: SuggestedActionView;
  readonly people: readonly PersonLinkOption[];
  readonly onClick: () => void;
}) {
  const status = STATUS_META[action.status] ?? {
    label: action.status,
    tone: "neutral" as const,
  };

  const isOverdue =
    action.dueAt &&
    new Date(action.dueAt) < new Date() &&
    action.status !== "completed" &&
    action.status !== "cancelled";

  let attentionTone: "ok" | "info" | "warn" | "risk" | "neutral" = status.tone;
  if (action.status !== "completed" && action.status !== "cancelled") {
    if (isOverdue) {
      attentionTone = "risk";
    } else if (action.priority === "critical") {
      attentionTone = "risk";
    } else if (action.priority === "high") {
      attentionTone = "warn";
    } else if (action.status === "in_progress") {
      attentionTone = "ok";
    }
  }

  const linkedPerson = people.find((p) => p.id === action.personId);

  return (
    <article className="action-row" style={{ cursor: "pointer" }} onClick={onClick}>
      <span className={`action-row__attention action-row__attention--${attentionTone}`} aria-hidden="true" />
      <div className="action-row__select" style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", background: "transparent", border: 0, padding: 0, textAlign: "left" }}>
        <div style={{ flex: 1, minWidth: 0, paddingRight: "var(--space-md)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
            <span className="action-row__title" style={{ fontSize: "14px", fontWeight: 500, color: "var(--colour-text-primary)" }}>{action.title}</span>
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
          </div>
          <p className="action-row__context" style={{ fontSize: "12px", color: "var(--colour-text-secondary)", margin: 0, display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <span>{status.label}</span>
            {action.dueAt ? <span style={{ color: isOverdue ? "var(--colour-danger)" : "inherit" }}>Due {formatDate(action.dueAt)}</span> : null}
            {action.followUpAt ? <span>Follow-up {formatDate(action.followUpAt)}</span> : null}
            {linkedPerson ? <span>Contact: {linkedPerson.displayName}</span> : null}
            {action.topics && action.topics.length > 0 ? (
              <span style={{ display: "flex", gap: "4px" }}>
                {action.topics.map((t) => (
                  <strong key={t} style={{ color: "var(--colour-accent-primary)" }}>#{t}</strong>
                ))}
              </span>
            ) : null}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {action.documents && action.documents.length > 0 && (
            <span title={`${action.documents.length} Attachment(s)`} style={{ color: "var(--colour-text-muted)", display: "flex", alignItems: "center" }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </span>
          )}
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: "var(--colour-text-muted)" }}>
            <path d="M7 3.5 L13.5 10 L7 16.5" />
          </svg>
        </div>
      </div>
    </article>
  );
}

// Quick Capture Modal Component
function QuickCaptureModal({
  isOpen,
  onClose,
  people,
  existingTopics,
}: {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly people: readonly PersonLinkOption[];
  readonly existingTopics: readonly string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form Fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<ActionPriority>("normal");
  const [status, setStatus] = useState<ActionStatus>("inbox");
  const [dueAt, setDueAt] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [newTopic, setNewTopic] = useState("");
  const [rationale, setRationale] = useState("");

  // AI Suggestions State
  const [suggestions, setSuggestions] = useState<{
    topics: string[];
    people: { id: string; displayName: string }[];
    dueAt: string | null;
    followUpAt: string | null;
    priority: ActionPriority;
    waitingOnSomeone: boolean;
  } | null>(null);

  // Esc key close
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (isOpen) {
      window.addEventListener("keydown", handleEsc);
    }
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  async function handleSuggest() {
    if (!title.trim()) {
      setError("Please enter an action title before requesting suggestions.");
      return;
    }
    setError(null);
    setIsSuggesting(true);

    try {
      const res = await suggestActionMetadata(title, description || undefined);
      if (res.ok && res.suggestions) {
        setSuggestions(res.suggestions);
      } else {
        setError(res.error ?? "Failed to parse context.");
      }
    } catch (err: any) {
      setError(err.message || "AI Suggestion engine encountered an error.");
    } finally {
      setIsSuggesting(false);
    }
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Action title is required.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const res = await createAction({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        status,
        dueAt: dueAt || null,
        followUpAt: followUpAt || null,
        topics,
        personId: selectedPersonId || null,
        rationale: rationale.trim() || null,
      });

      if (!res.ok) {
        setError(res.error ?? "Failed to save action.");
      } else {
        // Reset and close
        setTitle("");
        setDescription("");
        setPriority("normal");
        setStatus("inbox");
        setDueAt("");
        setFollowUpAt("");
        setSelectedPersonId("");
        setTopics([]);
        setNewTopic("");
        setRationale("");
        setSuggestions(null);
        onClose();
        router.refresh();
      }
    });
  }

  function addTopicTag(tag: string) {
    const clean = tag.trim();
    if (clean && !topics.includes(clean)) {
      setTopics([...topics, clean]);
    }
    setNewTopic("");
  }

  return (
    <div className="modal-backdrop" style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0, 0, 0, 0.75)", backdropFilter: "blur(4px)", padding: "var(--space-md)" }} onClick={onClose}>
      <div className="panel" style={{ width: "100%", maxWidth: "600px", maxHeight: "90vh", overflowY: "auto", background: "var(--colour-surface-elevated)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-md)", padding: "var(--space-lg)", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--colour-border)", paddingBottom: "var(--space-md)", marginBottom: "var(--space-md)" }}>
          <div>
            <p className="eyebrow" style={{ color: "var(--colour-accent-primary)" }}>Executive Workspace</p>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--colour-text-primary)", margin: 0 }}>Quick Capture Commitment</h2>
          </div>
          <button type="button" onClick={onClose} style={{ border: 0, background: "transparent", color: "var(--colour-text-muted)", fontSize: "20px", cursor: "pointer", padding: "4px" }} title="Close dialog">×</button>
        </div>

        {error && (
          <div className="alert alert--danger" style={{ padding: "10px 14px", borderRadius: "var(--radius-sm)", background: "rgba(224, 86, 36, 0.1)", color: "var(--colour-text-primary)", fontSize: "13px", marginBottom: "var(--space-md)" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSave} className="stack" style={{ gap: "var(--space-md)" }}>
          {/* Title and AI Suggest row */}
          <div className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <label htmlFor="modal-title" className="field__label" style={{ margin: 0 }}>Title <span style={{ color: "var(--colour-danger)" }}>*</span></label>
              <button
                type="button"
                onClick={handleSuggest}
                disabled={isSuggesting || !title.trim()}
                className="btn btn--secondary"
                style={{ fontSize: "11px", padding: "3px 8px", background: "rgba(100, 116, 139, 0.1)", borderColor: "var(--colour-border)", display: "flex", alignItems: "center", gap: "4px" }}
              >
                {isSuggesting ? (
                  <>AI Analyzing...</>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polygon points="12 2 2 22 22 22" />
                    </svg>
                    Suggest Context
                  </>
                )}
              </button>
            </div>
            <input
              id="modal-title"
              type="text"
              className="input"
              style={{ width: "100%", background: "var(--colour-surface-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", color: "var(--colour-text-primary)", padding: "10px 14px", fontSize: "14px" }}
              placeholder="e.g. Align with Maria on Q3 goals..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isPending}
              required
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="field">
            <label htmlFor="modal-description" className="field__label">Description / Notes</label>
            <textarea
              id="modal-description"
              className="input"
              style={{ width: "100%", background: "var(--colour-surface-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", color: "var(--colour-text-primary)", padding: "10px 14px", fontSize: "13px", resize: "vertical", minHeight: "80px", fontFamily: "inherit" }}
              placeholder="Add optional notes, deliverables, context..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isPending}
              rows={3}
            />
          </div>

          {/* Inline AI suggestions box if returned */}
          {suggestions && (
            <div className="alert alert--accent" style={{ padding: "14px", background: "rgba(100, 116, 139, 0.05)", border: "1px dashed var(--colour-border)", borderRadius: "var(--radius-sm)", fontSize: "12px" }}>
              <h4 style={{ fontWeight: 600, color: "var(--colour-accent-primary)", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>🤖</span> AI Extracted Proposals (Click to apply)
              </h4>

              <div className="stack" style={{ gap: "8px" }}>
                {/* Topic suggestions */}
                {suggestions.topics && suggestions.topics.length > 0 && (
                  <div>
                    <span style={{ color: "var(--colour-text-muted)", marginRight: "8px" }}>Topics:</span>
                    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "4px" }}>
                      {suggestions.topics.map((t) => {
                        const isSelected = topics.includes(t);
                        const isExisting = existingTopics.includes(t);
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => addTopicTag(t)}
                            disabled={isSelected}
                            className="chip chip--accent"
                            style={{ padding: "1px 6px", fontSize: "11px", opacity: isSelected ? 0.5 : 1, cursor: isSelected ? "default" : "pointer", border: isExisting ? "1px solid var(--colour-accent-primary)" : "1px dashed var(--colour-border)", background: "transparent" }}
                          >
                            + {t} {isExisting ? "" : "(New)"}
                          </button>
                        );
                      })}
                    </span>
                  </div>
                )}

                {/* People suggestions */}
                {suggestions.people && suggestions.people.length > 0 && (
                  <div>
                    <span style={{ color: "var(--colour-text-muted)", marginRight: "8px" }}>People:</span>
                    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "4px" }}>
                      {suggestions.people.map((p) => {
                        const isSelected = selectedPersonId === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setSelectedPersonId(p.id)}
                            disabled={isSelected}
                            className="chip"
                            style={{ padding: "1px 6px", fontSize: "11px", opacity: isSelected ? 0.5 : 1, cursor: isSelected ? "default" : "pointer" }}
                          >
                            + Link {p.displayName}
                          </button>
                        );
                      })}
                    </span>
                  </div>
                )}

                {/* Priority suggestion */}
                {suggestions.priority && (
                  <div>
                    <span style={{ color: "var(--colour-text-muted)", marginRight: "8px" }}>Priority:</span>
                    <button
                      type="button"
                      onClick={() => setPriority(suggestions.priority)}
                      disabled={priority === suggestions.priority}
                      className="chip"
                      style={{ padding: "1px 6px", fontSize: "11px" }}
                    >
                      Set to {suggestions.priority.toUpperCase()}
                    </button>
                  </div>
                )}

                {/* Date suggestions */}
                {(suggestions.dueAt || suggestions.followUpAt) && (
                  <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                    {suggestions.dueAt && (
                      <div>
                        <span style={{ color: "var(--colour-text-muted)", marginRight: "8px" }}>Due:</span>
                        <button
                          type="button"
                          onClick={() => setDueAt(suggestions.dueAt!)}
                          disabled={dueAt === suggestions.dueAt}
                          className="chip"
                          style={{ padding: "1px 6px", fontSize: "11px" }}
                        >
                          Due {formatDate(suggestions.dueAt)}
                        </button>
                      </div>
                    )}
                    {suggestions.followUpAt && (
                      <div>
                        <span style={{ color: "var(--colour-text-muted)", marginRight: "8px" }}>Follow-up:</span>
                        <button
                          type="button"
                          onClick={() => setFollowUpAt(suggestions.followUpAt!)}
                          disabled={followUpAt === suggestions.followUpAt}
                          className="chip"
                          style={{ padding: "1px 6px", fontSize: "11px" }}
                        >
                          Follow-up {formatDate(suggestions.followUpAt)}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {suggestions.waitingOnSomeone && (
                  <div>
                    <span style={{ color: "var(--colour-text-muted)", marginRight: "8px" }}>Status:</span>
                    <button
                      type="button"
                      onClick={() => setStatus("waiting")}
                      disabled={status === "waiting"}
                      className="chip"
                      style={{ padding: "1px 6px", fontSize: "11px" }}
                    >
                      Mark Waiting On Someone
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Status & Priority Row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-md)" }}>
            <div className="field">
              <label htmlFor="modal-status" className="field__label">Status</label>
              <select
                id="modal-status"
                className="input"
                style={{ width: "100%", background: "var(--colour-surface-primary)", color: "var(--colour-text-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", padding: "8px 12px" }}
                value={status}
                onChange={(e) => setStatus(e.target.value as ActionStatus)}
                disabled={isPending}
              >
                <option value="inbox">Inbox</option>
                <option value="planned">Planned</option>
                <option value="in_progress">In Progress</option>
                <option value="waiting">Waiting On</option>
                <option value="follow_up">Follow-up</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="modal-priority" className="field__label">Priority</label>
              <select
                id="modal-priority"
                className="input"
                style={{ width: "100%", background: "var(--colour-surface-primary)", color: "var(--colour-text-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", padding: "8px 12px" }}
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
          </div>

          {/* Dates Row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-md)" }}>
            <div className="field">
              <label htmlFor="modal-due" className="field__label">Due Date</label>
              <input
                id="modal-due"
                type="date"
                className="input"
                style={{ width: "100%", background: "var(--colour-surface-primary)", color: "var(--colour-text-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", padding: "8px 12px" }}
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                disabled={isPending}
              />
            </div>

            <div className="field">
              <label htmlFor="modal-followup" className="field__label">Follow-up Date</label>
              <input
                id="modal-followup"
                type="date"
                className="input"
                style={{ width: "100%", background: "var(--colour-surface-primary)", color: "var(--colour-text-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", padding: "8px 12px" }}
                value={followUpAt}
                onChange={(e) => setFollowUpAt(e.target.value)}
                disabled={isPending}
              />
            </div>
          </div>

          {/* Associated Person */}
          <div className="field">
            <label htmlFor="modal-person" className="field__label">Accountability / Person Link</label>
            <select
              id="modal-person"
              className="input"
              style={{ width: "100%", background: "var(--colour-surface-primary)", color: "var(--colour-text-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", padding: "8px 12px" }}
              value={selectedPersonId}
              onChange={(e) => setSelectedPersonId(e.target.value)}
              disabled={isPending}
            >
              <option value="">Unassigned / No Contact Link</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName} {p.organisation ? `(${p.organisation})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Source / Context Note */}
          <div className="field">
            <label htmlFor="modal-rationale" className="field__label">Source / Context Note</label>
            <input
              id="modal-rationale"
              type="text"
              className="input"
              style={{ width: "100%", background: "var(--colour-surface-primary)", color: "var(--colour-text-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", padding: "8px 12px", fontSize: "13px" }}
              placeholder="e.g. Discussed in 1:1, or Slack thread link..."
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              disabled={isPending}
            />
          </div>

          {/* Topics input */}
          <div className="field">
            <label className="field__label">Topics & strategic tags</label>
            <div className="stack" style={{ gap: "var(--space-xs)" }}>
              {topics.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "4px" }}>
                  {topics.map((t) => (
                    <span key={t} className="chip chip--accent" style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 8px" }}>
                      {t}
                      <button
                        type="button"
                        onClick={() => setTopics(topics.filter((top) => top !== t))}
                        style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", fontSize: "12px", fontWeight: "bold" }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Existing Topics Autocomplete dropdown */}
              {newTopic.trim() && (
                <div style={{ background: "var(--colour-surface-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", maxHeight: "120px", overflowY: "auto" }}>
                  {existingTopics
                    .filter((t) => t.toLowerCase().includes(newTopic.toLowerCase()) && !topics.includes(t))
                    .map((matched) => (
                      <button
                        key={matched}
                        type="button"
                        onClick={() => addTopicTag(matched)}
                        style={{ display: "block", width: "100%", padding: "6px 12px", textAlign: "left", fontSize: "12px", color: "var(--colour-text-primary)", background: "transparent", border: 0, cursor: "pointer", borderBottom: "1px solid var(--colour-border)" }}
                      >
                        Use existing: <strong>{matched}</strong>
                      </button>
                    ))}
                  {!topics.includes(newTopic.trim()) && (
                    <button
                      type="button"
                      onClick={() => addTopicTag(newTopic)}
                      style={{ display: "block", width: "100%", padding: "6px 12px", textAlign: "left", fontSize: "12px", color: "var(--colour-accent-primary)", background: "transparent", border: 0, cursor: "pointer" }}
                    >
                      + Confirm creating new topic: <strong>&ldquo;{newTopic.trim()}&rdquo;</strong>
                    </button>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  type="text"
                  className="input"
                  style={{ flex: 1, padding: "4px 8px", fontSize: "12px" }}
                  placeholder="e.g. Budget, Q3 Hiring"
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTopicTag(newTopic);
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn--secondary"
                  style={{ fontSize: "12px", padding: "4px 10px" }}
                  disabled={!newTopic.trim()}
                  onClick={() => addTopicTag(newTopic)}
                >
                  Add Tag
                </button>
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-sm)", borderTop: "1px solid var(--colour-border)", paddingTop: "var(--space-md)", marginTop: "var(--space-sm)" }}>
            <button type="button" className="btn btn--secondary" onClick={onClose} disabled={isPending}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={isPending || !title.trim()} style={{ minWidth: "100px" }}>
              {isPending ? "Saving..." : "Save Action"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// MAIN ACTIONS WORKSPACE COMPONENT
export function ActionsWorkspace({
  actions,
  people,
}: {
  readonly actions: readonly SuggestedActionView[];
  readonly people: readonly PersonLinkOption[];
}) {
  const router = useRouter();
  const [isQuickCaptureOpen, setIsQuickCaptureOpen] = useState(false);

  // Search and Filtering states
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all_active");
  const [filterTopic, setFilterTopic] = useState<string>("all");
  const [filterPerson, setFilterPerson] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterDate, setFilterDate] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);

  // Fetch unique topic tags from actions data for filter selector
  const availableTopics = useMemo(() => {
    const set = new Set<string>();
    actions.forEach((a) => {
      if (a.topics) {
        a.topics.forEach((t) => {
          if (t && t.trim()) set.add(t.trim());
        });
      }
    });
    return Array.from(set).sort();
  }, [actions]);

  // Map of views
  const viewsList = [
    { id: "all_active", label: "Attention Centre (Default)" },
    { id: "inbox", label: "Inbox" },
    { id: "planned", label: "Planned" },
    { id: "in_progress", label: "In Progress" },
    { id: "waiting", label: "Waiting On" },
    { id: "follow_up", label: "Follow-ups" },
    { id: "completed_cancelled", label: "Completed & Cancelled Logs" },
    { id: "by_topic", label: "Grouped by Topic" },
    { id: "by_person", label: "Grouped by Person" },
    { id: "all", label: "All Items Flat List" },
  ];

  // Helper date references
  const { todayStart, todayEnd, nextSevenDaysEnd } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const sevenDays = new Date(end);
    sevenDays.setDate(sevenDays.getDate() + 7);
    return { todayStart: start, todayEnd: end, nextSevenDaysEnd: sevenDays };
  }, []);

  // Filter and Search visible actions first
  const filteredActions = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return actions.filter((action) => {
      // 1. Text Search matching
      if (q) {
        const matchesTitle = action.title.toLowerCase().includes(q);
        const matchesDesc = (action.description ?? "").toLowerCase().includes(q);
        const matchesTopics = (action.topics || []).some((t) => t.toLowerCase().includes(q));
        const matchedPerson = people.find((p) => p.id === action.personId);
        const matchesPerson = matchedPerson ? matchedPerson.displayName.toLowerCase().includes(q) : false;
        const matchesSources = action.references?.some((r) => r.sourceSystem.toLowerCase().includes(q) || (r.excerptOrPointer ?? "").toLowerCase().includes(q)) ?? false;

        if (!matchesTitle && !matchesDesc && !matchesTopics && !matchesPerson && !matchesSources) {
          return false;
        }
      }

      // 2. Status filtering
      if (filterStatus === "all_active") {
        if (action.status === "completed" || action.status === "cancelled") return false;
      } else if (filterStatus === "completed_cancelled") {
        if (action.status !== "completed" && action.status !== "cancelled") return false;
      } else if (filterStatus === "by_topic" || filterStatus === "by_person" || filterStatus === "all") {
        // keep active only for grouping views
        if (action.status === "completed" || action.status === "cancelled") return false;
      } else {
        if (action.status !== filterStatus) return false;
      }

      // 3. Metadata Dropdown filters
      if (filterTopic !== "all") {
        if (!action.topics || !action.topics.includes(filterTopic)) return false;
      }

      if (filterPerson !== "all") {
        if (action.personId !== filterPerson) return false;
      }

      if (filterPriority !== "all") {
        if (action.priority !== filterPriority) return false;
      }

      if (filterDate !== "all") {
        if (!action.dueAt) return false;
        const dueTime = new Date(action.dueAt);
        if (filterDate === "overdue") {
          if (dueTime >= todayStart) return false;
        } else if (filterDate === "today") {
          if (dueTime < todayStart || dueTime > todayEnd) return false;
        } else if (filterDate === "week") {
          if (dueTime < todayStart || dueTime > nextSevenDaysEnd) return false;
        }
      }

      return true;
    });
  }, [actions, searchQuery, filterStatus, filterTopic, filterPerson, filterPriority, filterDate, todayStart, todayEnd, nextSevenDaysEnd, people]);

  // Construct target segmented focus blocks for Attention Centre view
  const attentionSections = useMemo(() => {
    if (filterStatus !== "all_active") return [];

    const overdue: SuggestedActionView[] = [];
    const dueToday: SuggestedActionView[] = [];
    const followUps: SuggestedActionView[] = [];
    const waiting: SuggestedActionView[] = [];
    const upcoming: SuggestedActionView[] = [];
    const inboxPlanned: SuggestedActionView[] = [];

    filteredActions.forEach((a) => {
      const isOver = a.dueAt && new Date(a.dueAt) < todayStart;
      const isToday = a.dueAt && new Date(a.dueAt) >= todayStart && new Date(a.dueAt) <= todayEnd;
      const isFollow = (a.followUpAt && new Date(a.followUpAt) <= todayEnd) || a.status === "follow_up";
      const isWait = a.status === "waiting";
      const isUp = a.dueAt && new Date(a.dueAt) > todayEnd;

      if (isOver) {
        overdue.push(a);
      } else if (isToday) {
        dueToday.push(a);
      } else if (isFollow) {
        followUps.push(a);
      } else if (isWait) {
        waiting.push(a);
      } else if (isUp) {
        upcoming.push(a);
      } else {
        inboxPlanned.push(a);
      }
    });

    return [
      { id: "overdue", label: "🚨 Overdue Deadlines", items: overdue, tone: "risk" },
      { id: "due_today", label: "📅 Due Today", items: dueToday, tone: "warn" },
      { id: "follow_ups", label: "🔔 Touch Base & Follow-ups", items: followUps, tone: "info" },
      { id: "waiting", label: "⏳ Blocked / Waiting On", items: waiting, tone: "neutral" },
      { id: "upcoming", label: "🗓️ Upcoming Deliverables", items: upcoming, tone: "info" },
      { id: "inbox_planned", label: "📥 Inbox & General Backlog", items: inboxPlanned, tone: "neutral" },
    ].filter((s) => s.items.length > 0);
  }, [filteredActions, filterStatus, todayStart, todayEnd]);

  // Grouping for "by_topic" or "by_person" views
  const groupedSections = useMemo(() => {
    if (filterStatus !== "by_topic" && filterStatus !== "by_person") return [];

    const list: { name: string; items: SuggestedActionView[] }[] = [];

    if (filterStatus === "by_topic") {
      const topicMap = new Map<string, SuggestedActionView[]>();
      const untagged: SuggestedActionView[] = [];

      filteredActions.forEach((action) => {
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

      Array.from(topicMap.keys())
        .sort()
        .forEach((topic) => {
          list.push({ name: `# ${topic}`, items: topicMap.get(topic)! });
        });

      if (untagged.length > 0) {
        list.push({ name: "Untagged Commitments", items: untagged });
      }
    } else if (filterStatus === "by_person") {
      const personMap = new Map<string, { name: string; items: SuggestedActionView[] }>();
      const unassigned: SuggestedActionView[] = [];

      filteredActions.forEach((action) => {
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

      Array.from(personMap.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((group) => {
          list.push({ name: `👤 ${group.name}`, items: group.items });
        });

      if (unassigned.length > 0) {
        list.push({ name: "Unassigned Commitments", items: unassigned });
      }
    }

    return list;
  }, [filteredActions, filterStatus, people]);

  return (
    <>
      {/* Dynamic Modal */}
      <QuickCaptureModal
        isOpen={isQuickCaptureOpen}
        onClose={() => setIsQuickCaptureOpen(false)}
        people={people}
        existingTopics={availableTopics}
      />

      {/* Main Header Panel */}
      <div className="page-head actions-page__head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-md)", flexWrap: "wrap", borderBottom: "1px solid var(--colour-border)", paddingBottom: "var(--space-md)" }}>
        <div style={{ flex: 1, minWidth: "300px" }}>
          <p className="eyebrow">Actions</p>
          <h1 className="page-head__title" style={{ margin: "4px 0" }}>Commitments & Accountability</h1>
          <p className="page-head__lead" style={{ margin: 0 }}>
            Executive-grade execution memory. Track deliverables, set strict priorities, prevent timeline slips, and avoid information-hoarding clutter.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsQuickCaptureOpen(true)}
          className="btn btn--primary"
          style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 18px", fontSize: "14px", fontWeight: 600, borderRadius: "var(--radius-sm)" }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Quick Capture
        </button>
      </div>

      {/* Filter and Search Bar Rail */}
      <section
        aria-label="Filters and Search"
        style={{
          display: "flex",
          flexDirection: "column",
          background: showFilters ? "var(--colour-surface-secondary)" : "transparent",
          border: showFilters ? "1px solid var(--colour-border)" : "none",
          borderRadius: "var(--radius-sm)",
          padding: showFilters ? "var(--space-md)" : "0",
          margin: "var(--space-md) 0",
          gap: showFilters ? "var(--space-md)" : "0"
        }}
      >
        {/* Row 1: Search Text & Filters Toggle */}
        <div style={{ display: "flex", gap: "12px", width: "100%", alignItems: "center", flexWrap: "wrap" }}>
          <div
            className="source-search actions-search"
            style={{
              margin: 0,
              flex: 1,
              minWidth: "280px",
              display: "flex",
              alignItems: "center",
              background: "var(--colour-surface-sunken)",
              border: "1px solid var(--colour-border)",
              borderRadius: "var(--radius-sm)"
            }}
          >
            <span className="source-search__icon" aria-hidden="true" style={{ top: "13px" }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.2-3.2" />
              </svg>
            </span>
            <input
              type="search"
              className="input source-search__input"
              style={{ width: "100%", height: "40px", paddingLeft: "40px", fontSize: "14px", border: "none", background: "transparent" }}
              placeholder="Search action details, topics, people, sources..."
              aria-label="Search actions"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                style={{ background: "transparent", border: 0, color: "var(--colour-text-muted)", cursor: "pointer", marginRight: "12px", fontSize: "12px" }}
              >
                Clear
              </button>
            )}
            <span className="source-search__count mono" style={{ marginRight: "16px", fontSize: "12px", position: "static", pointerEvents: "auto", whiteSpace: "nowrap" }}>
              {filteredActions.length} matches
            </span>
          </div>

          {/* Collapsible Filters Toggle Button */}
          <button
            type="button"
            className={`btn btn--secondary btn--sm`}
            style={{
              height: "42px",
              padding: "0 var(--space-md)",
              fontSize: "13px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "8px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--colour-border)",
              background: showFilters ? "var(--colour-border)" : "var(--colour-surface-secondary)",
              color: "var(--colour-text-primary)",
              cursor: "pointer"
            }}
            onClick={() => setShowFilters(!showFilters)}
            aria-expanded={showFilters}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: showFilters ? "var(--colour-accent-primary)" : "var(--colour-text-secondary)" }}>
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            <span>Filters</span>
            {/* Active filters count badge */}
            {(filterTopic !== "all" || filterPerson !== "all" || filterPriority !== "all" || filterDate !== "all") && (
              <span className="mono" style={{
                background: "var(--colour-accent-primary)",
                color: "#ffffff",
                borderRadius: "10px",
                padding: "2px 6px",
                fontSize: "10px",
                fontWeight: "bold",
                lineHeight: 1
              }}>
                {[filterTopic, filterPerson, filterPriority, filterDate].filter(f => f !== "all").length}
              </span>
            )}
          </button>
        </div>

        {/* Row 2: Metadata Dropdown selectors */}
        {showFilters && (
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", width: "100%" }}>
            {/* Topic Filter */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "11px", color: "var(--colour-text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>Topic:</span>
              <select
                className="input"
                style={{ height: "32px", padding: "0 8px", fontSize: "12px", background: "var(--colour-surface-sunken)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", color: "var(--colour-text-primary)", minWidth: "120px" }}
                value={filterTopic}
                onChange={(e) => setFilterTopic(e.target.value)}
              >
                <option value="all">All Topics</option>
                {availableTopics.map((t) => (
                  <option key={t} value={t}>#{t}</option>
                ))}
              </select>
            </div>

            {/* Person Filter */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "11px", color: "var(--colour-text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>Person:</span>
              <select
                className="input"
                style={{ height: "32px", padding: "0 8px", fontSize: "12px", background: "var(--colour-surface-sunken)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", color: "var(--colour-text-primary)", minWidth: "120px" }}
                value={filterPerson}
                onChange={(e) => setFilterPerson(e.target.value)}
              >
                <option value="all">Everyone</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.displayName}</option>
                ))}
              </select>
            </div>

            {/* Priority Filter */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "11px", color: "var(--colour-text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>Priority:</span>
              <select
                className="input"
                style={{ height: "32px", padding: "0 8px", fontSize: "12px", background: "var(--colour-surface-sunken)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", color: "var(--colour-text-primary)", minWidth: "100px" }}
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
              >
                <option value="all">All Priorities</option>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>

            {/* Due Date Range Filter */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "11px", color: "var(--colour-text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>Date:</span>
              <select
                className="input"
                style={{ height: "32px", padding: "0 8px", fontSize: "12px", background: "var(--colour-surface-sunken)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", color: "var(--colour-text-primary)", minWidth: "120px" }}
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
              >
                <option value="all">Any Due Date</option>
                <option value="overdue">Overdue</option>
                <option value="today">Due Today</option>
                <option value="week">Due Next 7 Days</option>
              </select>
            </div>

            {/* Reset Filters button */}
            {(filterTopic !== "all" || filterPerson !== "all" || filterPriority !== "all" || filterDate !== "all") && (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => {
                  setFilterTopic("all");
                  setFilterPerson("all");
                  setFilterPriority("all");
                  setFilterDate("all");
                }}
                style={{ height: "32px", padding: "0 12px", fontSize: "11px" }}
              >
                Reset Filters
              </button>
            )}
          </div>
        )}
      </section>

      {/* Main Workspace Layout Shell */}
      <div className="actions-shell">
        {/* Nav tabs Left / Top */}
        <nav className="actions-views" aria-label="Action views">
          <div className="actions-views__label">Views</div>
          {viewsList.map((item) => {
            const isActive = filterStatus === item.id;
            let badgeCount = 0;

            if (item.id === "all") {
              badgeCount = actions.length;
            } else if (item.id === "all_active") {
              badgeCount = actions.filter((a) => a.status !== "completed" && a.status !== "cancelled").length;
            } else if (item.id === "completed_cancelled") {
              badgeCount = actions.filter((a) => a.status === "completed" || a.status === "cancelled").length;
            } else if (item.id === "by_topic" || item.id === "by_person") {
              badgeCount = actions.filter((a) => a.status !== "completed" && a.status !== "cancelled").length;
            } else {
              badgeCount = actions.filter((a) => a.status === item.id).length;
            }

            return (
              <button
                key={item.id}
                type="button"
                className={`actions-view${isActive ? " actions-view--active" : ""}`}
                aria-pressed={isActive}
                onClick={() => setFilterStatus(item.id)}
              >
                <span>{item.label}</span>
                <span className="actions-view__count mono">{badgeCount}</span>
              </button>
            );
          })}
        </nav>

        {/* Dense List Work Area */}
        <section className="actions-working-set" aria-labelledby="working-set-title" style={{ padding: 0 }}>
          {filteredActions.length === 0 ? (
            <div className="empty actions-empty" style={{
              margin: "var(--space-lg) 0",
              padding: "var(--space-xl) var(--space-md)",
              background: "rgba(255, 255, 255, 0.01)",
              border: "1px solid rgba(255, 255, 255, 0.05)",
              borderRadius: "var(--radius-md)",
              textAlign: "center"
            }}>
              <p className="empty__title" style={{ fontSize: "var(--text-body)", fontWeight: 600, color: "var(--colour-text-primary)", margin: 0 }}>
                {searchQuery || filterTopic !== "all" || filterPerson !== "all" || filterPriority !== "all" || filterDate !== "all"
                  ? "No commitments match your active filters"
                  : "No active commitments in this category"}
              </p>
              <p className="empty__body" style={{ fontSize: "var(--text-small)", color: "var(--colour-text-secondary)", marginTop: "var(--space-xs)", lineHeight: "var(--leading-normal)" }}>
                {searchQuery || filterTopic !== "all" || filterPerson !== "all" || filterPriority !== "all" || filterDate !== "all"
                  ? "Try resetting filters or adjusting search queries to locate your record."
                  : "Every commitment, task, and promise extracted from your feeds is logged here. Create a manual record with 'Quick Capture'."}
              </p>
            </div>
          ) : filterStatus === "all_active" ? (
            // Focused Attention Centre View (Segmented Focus sections)
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)", marginTop: "var(--space-sm)" }}>
              {attentionSections.map((sec) => (
                <div key={sec.id} style={{ border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", overflow: "hidden", background: "var(--colour-surface-secondary)" }}>
                  <div style={{ background: "rgba(255, 255, 255, 0.02)", padding: "10px 16px", borderBottom: "1px solid var(--colour-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3 style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", color: "var(--colour-text-secondary)", fontFamily: "var(--font-mono)", margin: 0 }}>
                      {sec.label}
                    </h3>
                    <span className="badge" style={{ fontSize: "11px", padding: "1px 6px", background: "var(--colour-border)", borderRadius: "10px" }}>{sec.items.length}</span>
                  </div>
                  <div className="action-list">
                    {sec.items.map((item) => (
                      <ActionRow
                        key={`${sec.id}-${item.id}`}
                        action={item}
                        people={people}
                        onClick={() => router.push(`/actions/${item.id}`)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : filterStatus === "by_topic" || filterStatus === "by_person" ? (
            // Grouped Section Views
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)", marginTop: "var(--space-sm)" }}>
              {groupedSections.map((group) => (
                <div key={group.name} style={{ border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", overflow: "hidden", background: "var(--colour-surface-secondary)" }}>
                  <div style={{ background: "rgba(255, 255, 255, 0.02)", padding: "10px 16px", borderBottom: "1px solid var(--colour-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3 style={{ fontSize: "12px", fontWeight: 600, color: "var(--colour-text-secondary)", fontFamily: "var(--font-mono)", margin: 0 }}>
                      {group.name}
                    </h3>
                    <span className="badge" style={{ fontSize: "11px", padding: "1px 6px", background: "var(--colour-border)", borderRadius: "10px" }}>{group.items.length}</span>
                  </div>
                  <div className="action-list">
                    {group.items.map((item) => (
                      <ActionRow
                        key={`${group.name}-${item.id}`}
                        action={item}
                        people={people}
                        onClick={() => router.push(`/actions/${item.id}`)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // Flat Categorized Views
            <div className="action-list" style={{ border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", overflow: "hidden", background: "var(--colour-surface-secondary)", marginTop: "var(--space-sm)" }}>
              {filteredActions.map((item) => (
                <ActionRow
                  key={item.id}
                  action={item}
                  people={people}
                  onClick={() => router.push(`/actions/${item.id}`)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
