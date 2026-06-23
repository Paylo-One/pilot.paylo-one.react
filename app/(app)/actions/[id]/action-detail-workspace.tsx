"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateAction, snoozeAction, completeAction, registerActionDocument, removeActionDocument } from "../actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { PersonLinkControl, type PersonLinkOption } from "@/components/refinement/person-link-control";
import type { ActionStatus, ActionPriority } from "@/modules/action-extraction/server";

interface ActionDetailWorkspaceProps {
  readonly action: {
    readonly id: string;
    readonly status: ActionStatus;
    readonly title: string;
    readonly rationale: string | null;
    readonly dueAt: string | null;
    readonly personId: string | null;
    readonly createdAt: string;
    readonly description: string | null;
    readonly followUpAt: string | null;
    readonly priority: ActionPriority;
    readonly completedAt: string | null;
    readonly snoozedUntil: string | null;
    readonly createdBy: string | null;
    readonly createdFrom: string;
    readonly topics: readonly string[];
    readonly snoozeMetadata: any;
    readonly completionMetadata: any;
    readonly documents: readonly any[];
    readonly references: readonly {
      readonly id: string;
      readonly sourceSystem: string;
      readonly itemTimestamp: string | null;
      readonly confidence: number | null;
      readonly excerptOrPointer: string | null;
      readonly diaryEntryId: string | null;
    }[];
  };
  readonly tenantId: string;
  readonly people: readonly PersonLinkOption[];
  readonly existingTopics: readonly string[];
}

const STATUS_META: Record<ActionStatus, { label: string; tone: "ok" | "info" | "warn" | "risk" | "neutral" }> = {
  inbox: { label: "Needs approval", tone: "warn" },
  planned: { label: "Planned", tone: "info" },
  in_progress: { label: "In progress", tone: "ok" },
  waiting: { label: "Waiting on", tone: "neutral" },
  follow_up: { label: "Follow-up", tone: "warn" },
  completed: { label: "Completed", tone: "ok" },
  cancelled: { label: "Not an action", tone: "neutral" },
};

export function ActionDetailWorkspace({
  action,
  tenantId,
  people,
  existingTopics,
}: ActionDetailWorkspaceProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSnoozePending, startSnoozeTransition] = useTransition();
  const [isCompletePending, startCompleteTransition] = useTransition();
  const [isUploadPending, setIsUploadPending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form Fields for Title/Description (manual save)
  const [title, setTitle] = useState(action.title);
  const [description, setDescription] = useState(action.description ?? "");
  const [rationale, setRationale] = useState(action.rationale ?? "");
  const [detailsSaved, setDetailsSaved] = useState(false);

  // Quick State edits with instant-save
  const [status, setStatus] = useState<ActionStatus>(action.status);
  const [priority, setPriority] = useState<ActionPriority>(action.priority);
  const [dueAt, setDueAt] = useState(action.dueAt ? action.dueAt.substring(0, 10) : "");
  const [followUpAt, setFollowUpAt] = useState(action.followUpAt ? action.followUpAt.substring(0, 10) : "");
  const [topics, setTopics] = useState<string[]>([...action.topics]);
  const [newTopic, setNewTopic] = useState("");

  // Controls for snoozing & completion
  const [snoozeUntil, setSnoozeUntil] = useState("");
  const [snoozeReason, setSnoozeReason] = useState("");
  const [completionFeedback, setCompletionFeedback] = useState("");

  // Inline document removal confirmation (replaces window.confirm)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const isSnoozed = Boolean(action.snoozedUntil && new Date(action.snoozedUntil) > new Date());
  const statusMeta = STATUS_META[status];

  // Handle saving Title & Description
  async function handleSaveDetails(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setDetailsSaved(false);

    if (!title.trim()) {
      setError("Action title cannot be empty.");
      return;
    }

    startTransition(async () => {
      const res = await updateAction(action.id, {
        title: title.trim(),
        description: description.trim() || null,
        rationale: rationale.trim() || null,
      });

      if (!res.ok) {
        setError(res.error ?? "Failed to save details.");
      } else {
        setDetailsSaved(true);
        setTimeout(() => setDetailsSaved(false), 3000);
        router.refresh();
      }
    });
  }

  // Quick update helper for metadata items
  async function triggerMetadataUpdate(updatedFields: {
    status?: ActionStatus;
    priority?: ActionPriority;
    dueAt?: string | null;
    followUpAt?: string | null;
    topics?: string[];
  }) {
    setError(null);
    setSuccess(null);

    const res = await updateAction(action.id, updatedFields);
    if (!res.ok) {
      setError(res.error ?? "Failed to update action metadata.");
      // Rollback client state if failed
      if (updatedFields.status !== undefined) setStatus(action.status);
      if (updatedFields.priority !== undefined) setPriority(action.priority);
      if (updatedFields.dueAt !== undefined) setDueAt(action.dueAt ? action.dueAt.substring(0, 10) : "");
      if (updatedFields.followUpAt !== undefined) setFollowUpAt(action.followUpAt ? action.followUpAt.substring(0, 10) : "");
      if (updatedFields.topics !== undefined) setTopics([...action.topics]);
    } else {
      router.refresh();
    }
  }

  // Topics
  function handleAddTopic(topicName: string) {
    const clean = topicName.trim();
    if (clean && !topics.includes(clean)) {
      const nextTopics = [...topics, clean];
      setTopics(nextTopics);
      setNewTopic("");
      triggerMetadataUpdate({ topics: nextTopics });
    }
  }

  function handleRemoveTopic(tag: string) {
    const nextTopics = topics.filter((t) => t !== tag);
    setTopics(nextTopics);
    triggerMetadataUpdate({ topics: nextTopics });
  }

  // Snoozing
  function handleSnoozeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!snoozeUntil) {
      setError("Please select a snooze date.");
      return;
    }
    setError(null);

    startSnoozeTransition(async () => {
      const res = await snoozeAction(action.id, snoozeUntil, snoozeReason || undefined);
      if (!res.ok) {
        setError(res.error ?? "Failed to snooze action.");
      } else {
        setSuccess(`Snoozed until ${formatDateString(snoozeUntil)}.`);
        setSnoozeUntil("");
        setSnoozeReason("");
        setStatus("planned");
        router.refresh();
      }
    });
  }

  function handleClearSnooze() {
    setError(null);
    startSnoozeTransition(async () => {
      const res = await snoozeAction(action.id, null);
      if (!res.ok) {
        setError(res.error ?? "Failed to clear snooze.");
      } else {
        setSuccess("Snooze cleared.");
        router.refresh();
      }
    });
  }

  // Completion
  function handleCompleteSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startCompleteTransition(async () => {
      const res = await completeAction(action.id, completionFeedback || undefined);
      if (!res.ok) {
        setError(res.error ?? "Failed to complete action.");
      } else {
        setSuccess("Marked complete.");
        setCompletionFeedback("");
        setStatus("completed");
        router.refresh();
      }
    });
  }

  // File Upload Handling
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setError(null);
    setSuccess(null);
    setIsUploadPending(true);
    setUploadProgress(10);

    const supabase = createSupabaseBrowserClient();

    try {
      const file = files[0];
      if (!file) {
        setError("No file found.");
        setIsUploadPending(false);
        setUploadProgress(null);
        return;
      }

      // File Guardrails (e.g. max size 15MB)
      const MAX_SIZE = 15 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        setError("File size exceeds the 15MB limit. Please upload a smaller file.");
        setIsUploadPending(false);
        setUploadProgress(null);
        return;
      }

      setUploadProgress(40);

      // Path template: {tenantId}/actions/{actionId}/{fileId}-{filename}
      const fileId = crypto.randomUUID();
      const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const path = `${tenantId}/actions/${action.id}/${fileId}-${cleanFileName}`;

      const { error: uploadErr } = await supabase.storage
        .from("uploads")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadErr) {
        throw new Error(`Supabase Storage: ${uploadErr.message}`);
      }

      setUploadProgress(70);

      // Register the metadata
      const { data: { user } } = await supabase.auth.getUser();
      const docMetadata = {
        id: fileId,
        name: file.name,
        path,
        type: file.type,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        uploadedBy: user?.email || user?.id || "unknown",
      };

      const registerRes = await registerActionDocument(action.id, docMetadata);
      if (!registerRes.ok) {
        throw new Error(registerRes.error ?? "Failed to link uploaded document to action.");
      }

      setUploadProgress(100);
      setSuccess(`“${file.name}” uploaded and linked.`);
      router.refresh();
    } catch (err: any) {
      setError(err.message || "An error occurred during file upload.");
    } finally {
      setIsUploadPending(false);
      setUploadProgress(null);
      e.target.value = "";
    }
  }

  async function handleDeleteFile(fileId: string) {
    setConfirmRemoveId(null);
    setError(null);
    setSuccess(null);

    const res = await removeActionDocument(action.id, fileId);
    if (!res.ok) {
      setError(res.error ?? "Failed to delete document.");
    } else {
      setSuccess("Document removed.");
      router.refresh();
    }
  }

  async function handleDownloadFile(filePath: string, fileName: string) {
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: signedErr } = await supabase.storage
        .from("uploads")
        .createSignedUrl(filePath, 300);

      if (signedErr) {
        setError("Failed to generate download link: " + signedErr.message);
        return;
      }

      if (data?.signedUrl) {
        const link = document.createElement("a");
        link.href = data.signedUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (err: any) {
      setError("Error downloading file: " + err.message);
    }
  }

  // Format Helper
  function formatDateString(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  function applyPreset(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setSnoozeUntil(d.toISOString().substring(0, 10));
  }

  return (
    <div className="action-detail">
      {/* Topbar: back + identity */}
      <div className="action-detail__topbar">
        <Link href="/actions" className="btn btn--secondary btn--sm action-detail__back">
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M13.5 16.5 L7 10 L13.5 3.5" />
          </svg>
          Back to Actions
        </Link>
        <div className="action-detail__identity">
          <span className={`status status--${statusMeta.tone}`}>{statusMeta.label}</span>
          <span className="badge badge--plain" title={action.id}>
            {action.id.substring(0, 8)}
          </span>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="alert alert--risk" role="alert">
          <div>
            <p className="alert__title">Something went wrong</p>
            <p className="alert__body">{error}</p>
          </div>
        </div>
      )}
      {success && (
        <div className="alert alert--ok" role="status">
          <div>
            <p className="alert__title">Saved</p>
            <p className="alert__body">{success}</p>
          </div>
        </div>
      )}

      {/* Snoozed Banner */}
      {isSnoozed && (
        <div className="alert alert--accent action-detail__snooze-banner">
          <div>
            <p className="alert__title">Snoozed until {formatDateString(action.snoozedUntil!)}</p>
            {action.snoozeMetadata?.last_snooze?.reason && (
              <p className="alert__body">“{action.snoozeMetadata.last_snooze.reason}”</p>
            )}
          </div>
          <button type="button" onClick={handleClearSnooze} disabled={isSnoozePending} className="btn btn--secondary btn--sm">
            {isSnoozePending ? "Clearing…" : "Un-snooze"}
          </button>
        </div>
      )}

      {/* 2-Column Grid */}
      <div className="action-detail__grid">
        {/* LEFT: content, documents, sources, history */}
        <div className="action-detail__main">
          {/* Main Details */}
          <section className="panel">
            <form onSubmit={handleSaveDetails}>
              <div className="field">
                <label htmlFor="action-title-input" className="field__label">Action title</label>
                <input
                  id="action-title-input"
                  type="text"
                  className="input action-detail__title-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={isPending}
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="action-desc-input" className="field__label">Description &amp; objectives</label>
                <textarea
                  id="action-desc-input"
                  className="textarea"
                  rows={6}
                  placeholder="Context, deliverables, expectations, or exact notes…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isPending}
                />
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="action-rationale-input" className="field__label">Source &amp; context notes</label>
                <input
                  id="action-rationale-input"
                  type="text"
                  className="input"
                  placeholder="e.g. Discussed with Maria in the weekly 1:1, or a workspace link…"
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  disabled={isPending}
                />
              </div>

              <div className="action-detail__form-footer">
                <button type="submit" className="btn btn--primary" disabled={isPending}>
                  {isPending ? "Saving…" : detailsSaved ? "Saved" : "Save details"}
                </button>
              </div>
            </form>
          </section>

          {/* Documents */}
          <section className="panel">
            <div className="card-head">
              <div>
                <h2 className="card__title">Documents</h2>
                <p className="action-detail__panel-hint">
                  Agreements, briefs, or assets needed to execute this action. Kept inside your workspace.
                </p>
              </div>
              {action.documents.length > 0 ? (
                <span className="actions-count">{action.documents.length}</span>
              ) : null}
            </div>

            {action.documents && action.documents.length > 0 && (
              <div className="doc-list">
                {action.documents.map((doc: any) => (
                  <div key={doc.id} className="doc-item">
                    <span className="doc-item__icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </span>
                    <div className="doc-item__body">
                      <button
                        type="button"
                        onClick={() => handleDownloadFile(doc.path, doc.name)}
                        className="doc-item__name"
                        title="Download"
                      >
                        {doc.name}
                      </button>
                      <p className="doc-item__meta">
                        {formatBytes(doc.size)} · {formatDateString(doc.uploadedAt)} · {String(doc.uploadedBy).split("@")[0]}
                      </p>
                    </div>
                    {confirmRemoveId === doc.id ? (
                      <div className="doc-item__confirm">
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmRemoveId(null)}>
                          Cancel
                        </button>
                        <button type="button" className="btn btn--danger btn--sm" onClick={() => handleDeleteFile(doc.id)}>
                          Remove
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(doc.id)}
                        className="doc-item__remove"
                        aria-label={`Remove ${doc.name}`}
                        title="Remove"
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Upload Area */}
            <div className="doc-dropzone">
              <input
                id="doc-upload-input"
                type="file"
                className="doc-dropzone__input"
                onChange={handleFileUpload}
                disabled={isUploadPending}
                aria-label="Upload a document"
              />
              <svg className="doc-dropzone__icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <p className="doc-dropzone__title">
                {isUploadPending ? "Uploading…" : "Click or drop a file to upload"}
              </p>
              <p className="doc-dropzone__hint">Up to 15MB. PDF, images, or text documents.</p>
            </div>

            {isUploadPending && uploadProgress !== null && (
              <div className="upload-progress">
                <div className="upload-progress__head">
                  <span>Uploading…</span>
                  <span className="mono">{uploadProgress}%</span>
                </div>
                <div className="upload-progress__track">
                  <div className="upload-progress__bar" style={{ transform: `scaleX(${uploadProgress / 100})` }} />
                </div>
              </div>
            )}
          </section>

          {/* Sources */}
          {action.references && action.references.length > 0 && (
            <section className="panel">
              <div className="card-head">
                <div>
                  <h2 className="card__title">Sources &amp; traceability</h2>
                  <p className="action-detail__panel-hint">Where this action came from.</p>
                </div>
                <span className="actions-count">{action.references.length}</span>
              </div>

              <div className="detail-source-list">
                {action.references.map((reference) => (
                  <div key={reference.id} className="detail-source">
                    <div className="detail-source__head">
                      <span>{reference.sourceSystem.replaceAll("_", " ")}</span>
                      {reference.itemTimestamp && (
                        <time dateTime={reference.itemTimestamp}>{formatDateString(reference.itemTimestamp)}</time>
                      )}
                    </div>
                    {reference.excerptOrPointer ? (
                      <p className="detail-source__excerpt">{reference.excerptOrPointer}</p>
                    ) : (
                      <p className="detail-source__excerpt detail-source__excerpt--muted">Reference logged securely.</p>
                    )}
                    {reference.diaryEntryId ? (
                      <Link href={`/diary?entry=${reference.diaryEntryId}`} className="btn btn--ghost btn--sm">
                        Open diary reference
                      </Link>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* History */}
          <section className="panel">
            <div className="card-head">
              <h2 className="card__title">History</h2>
            </div>

            <ol className="timeline">
              <li className="timeline__row">
                <span className="timeline__time mono">{formatDateString(action.createdAt)}</span>
                <div className="timeline__body">
                  <p className="timeline__title">Created</p>
                  <p className="timeline__meta">
                    {action.createdFrom === "manual" ? "Manually captured" : "AI pipeline extraction"}
                  </p>
                </div>
              </li>

              {action.snoozeMetadata?.history?.map((snooze: any, index: number) => (
                <li key={`${snooze.snoozed_at}-${index}`} className="timeline__row">
                  <span className="timeline__time mono">{formatDateString(snooze.snoozed_at)}</span>
                  <div className="timeline__body">
                    <p className="timeline__title">Snoozed</p>
                    <p className="timeline__meta">Rescheduled to {formatDateString(snooze.snoozed_until)}</p>
                    {snooze.reason ? <p className="timeline__quote">“{snooze.reason}”</p> : null}
                  </div>
                </li>
              ))}

              {action.status === "completed" && action.completedAt && (
                <li className="timeline__row">
                  <span className="timeline__time mono">{formatDateString(action.completedAt)}</span>
                  <div className="timeline__body">
                    <p className="timeline__title timeline__title--ok">Completed</p>
                    {action.completionMetadata?.feedback && (
                      <p className="timeline__quote">“{action.completionMetadata.feedback}”</p>
                    )}
                  </div>
                </li>
              )}
            </ol>
          </section>
        </div>

        {/* RIGHT: metadata rail */}
        <div className="action-detail__rail">
          {/* Properties */}
          <section className="panel">
            <h2 className="action-detail__rail-title">Properties</h2>

            <div className="field">
              <label htmlFor="detail-status" className="field__label">Status</label>
              <select
                id="detail-status"
                className="input"
                value={status}
                onChange={(e) => {
                  const nextVal = e.target.value as ActionStatus;
                  setStatus(nextVal);
                  triggerMetadataUpdate({ status: nextVal });
                }}
              >
                <option value="inbox">Needs approval</option>
                <option value="planned">Planned</option>
                <option value="in_progress">In progress</option>
                <option value="waiting">Waiting on someone</option>
                <option value="follow_up">Follow-up</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Not an action</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="detail-priority" className="field__label">Priority</label>
              <select
                id="detail-priority"
                className="input"
                value={priority}
                onChange={(e) => {
                  const nextVal = e.target.value as ActionPriority;
                  setPriority(nextVal);
                  triggerMetadataUpdate({ priority: nextVal });
                }}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="detail-due" className="field__label">Due date</label>
              <div className="input-suffix">
                <input
                  id="detail-due"
                  type="date"
                  className="input"
                  value={dueAt}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDueAt(val);
                    triggerMetadataUpdate({ dueAt: val || null });
                  }}
                />
                {dueAt && (
                  <button
                    type="button"
                    onClick={() => {
                      setDueAt("");
                      triggerMetadataUpdate({ dueAt: null });
                    }}
                    className="btn btn--ghost btn--sm"
                    title="Clear due date"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="detail-followup" className="field__label">Follow-up date</label>
              <div className="input-suffix">
                <input
                  id="detail-followup"
                  type="date"
                  className="input"
                  value={followUpAt}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFollowUpAt(val);
                    triggerMetadataUpdate({ followUpAt: val || null });
                  }}
                />
                {followUpAt && (
                  <button
                    type="button"
                    onClick={() => {
                      setFollowUpAt("");
                      triggerMetadataUpdate({ followUpAt: null });
                    }}
                    className="btn btn--ghost btn--sm"
                    title="Clear follow-up date"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Accountability */}
          <section className="panel">
            <h2 className="action-detail__rail-title">Accountability</h2>
            <p className="action-detail__panel-hint">Link the person responsible or the primary contact.</p>
            <PersonLinkControl
              targetId={action.id}
              people={people}
              initialPersonId={action.personId}
              onChange={async (nextPersonId) => {
                const res = await updateAction(action.id, { personId: nextPersonId });
                if (res.ok) {
                  router.refresh();
                }
                return res;
              }}
            />
          </section>

          {/* Topics */}
          <section className="panel">
            <h2 className="action-detail__rail-title">Topics</h2>

            {topics.length > 0 ? (
              <div className="topic-chips">
                {topics.map((tag) => (
                  <span key={tag} className="chip chip--accent">
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTopic(tag)}
                      className="topic-chips__remove"
                      aria-label={`Remove topic ${tag}`}
                    >
                      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M4 4l8 8M12 4l-8 8" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="action-detail__panel-hint">No topics linked yet.</p>
            )}

            {newTopic.trim() && (
              <div className="topic-suggest">
                {existingTopics
                  .filter((t) => t.toLowerCase().includes(newTopic.toLowerCase()) && !topics.includes(t))
                  .map((matched) => (
                    <button key={matched} type="button" onClick={() => handleAddTopic(matched)} className="topic-suggest__item">
                      Use existing: <strong>{matched}</strong>
                    </button>
                  ))}
                {!topics.includes(newTopic.trim()) && (
                  <button type="button" onClick={() => handleAddTopic(newTopic)} className="topic-suggest__item topic-suggest__item--new">
                    Create “{newTopic.trim()}”
                  </button>
                )}
              </div>
            )}

            <div className="input-suffix action-detail__topic-add">
              <input
                type="text"
                className="input"
                placeholder="Add a topic…"
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTopic(newTopic);
                  }
                }}
              />
              <button type="button" className="btn btn--secondary btn--sm" disabled={!newTopic.trim()} onClick={() => handleAddTopic(newTopic)}>
                Add
              </button>
            </div>
          </section>

          {/* Snooze */}
          {status !== "completed" && status !== "cancelled" && !isSnoozed && (
            <section className="panel">
              <h2 className="action-detail__rail-title">Snooze</h2>
              <form onSubmit={handleSnoozeSubmit}>
                <div className="field">
                  <label htmlFor="snooze-until-input" className="field__label">Snooze until</label>
                  <input
                    id="snooze-until-input"
                    type="date"
                    className="input"
                    value={snoozeUntil}
                    onChange={(e) => setSnoozeUntil(e.target.value)}
                    disabled={isSnoozePending}
                    required
                  />
                  <div className="action-detail__presets">
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => applyPreset(1)}>
                      Tomorrow
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => applyPreset(7)}>
                      Next week
                    </button>
                  </div>
                </div>

                <div className="field" style={{ marginBottom: "var(--space-md)" }}>
                  <label htmlFor="snooze-reason-input" className="field__label">Reason (optional)</label>
                  <input
                    id="snooze-reason-input"
                    type="text"
                    className="input"
                    placeholder="e.g. Waiting for team alignment…"
                    value={snoozeReason}
                    onChange={(e) => setSnoozeReason(e.target.value)}
                    disabled={isSnoozePending}
                  />
                </div>

                <button type="submit" className="btn btn--secondary btn--block" disabled={isSnoozePending || !snoozeUntil}>
                  {isSnoozePending ? "Snoozing…" : "Snooze"}
                </button>
              </form>
            </section>
          )}

          {/* Complete */}
          {status !== "completed" && (
            <section className="panel">
              <h2 className="action-detail__rail-title">Complete</h2>
              <form onSubmit={handleCompleteSubmit}>
                <div className="field" style={{ marginBottom: "var(--space-md)" }}>
                  <label htmlFor="completion-feedback-input" className="field__label">Closure note (optional)</label>
                  <input
                    id="completion-feedback-input"
                    type="text"
                    className="input"
                    placeholder="e.g. Client signed off on the pipeline…"
                    value={completionFeedback}
                    onChange={(e) => setCompletionFeedback(e.target.value)}
                    disabled={isCompletePending}
                  />
                </div>
                <button type="submit" className="btn btn--primary btn--block" disabled={isCompletePending}>
                  {isCompletePending ? "Completing…" : "Mark complete"}
                </button>
              </form>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
