"use client";

import { useState, useTransition, useMemo } from "react";
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
    }[];
  };
  readonly tenantId: string;
  readonly people: readonly PersonLinkOption[];
  readonly existingTopics: readonly string[];
}

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

  const isSnoozed = action.snoozedUntil && new Date(action.snoozedUntil) > new Date();

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
        setSuccess(`Action successfully snoozed until ${snoozeUntil}.`);
        setSnoozeUntil("");
        setSnoozeReason("");
        setStatus("planned"); // will change client local visual representation or let server refresh update
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
        setSuccess("Action successfully completed.");
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

      const { data: uploadData, error: uploadErr } = await supabase.storage
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
      setSuccess(`File "${file.name}" uploaded and linked successfully.`);
      router.refresh();
    } catch (err: any) {
      setError(err.message || "An error occurred during file upload.");
    } finally {
      setIsUploadPending(false);
      setUploadProgress(null);
    }
  }

  async function handleDeleteFile(fileId: string) {
    if (!window.confirm("Are you sure you want to remove this document?")) return;
    setError(null);
    setSuccess(null);

    const res = await removeActionDocument(action.id, fileId);
    if (!res.ok) {
      setError(res.error ?? "Failed to delete document.");
    } else {
      setSuccess("Document deleted successfully.");
      router.refresh();
    }
  }

  async function handleDownloadFile(filePath: string, fileName: string) {
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: signedErr } = await supabase.storage
        .from("uploads")
        .createSignedUrl(filePath, 300);

      if (signedErr) {
        alert("Failed to generate download link: " + signedErr.message);
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
      alert("Error downloading file: " + err.message);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)", maxWidth: "1200px", margin: "0 auto", padding: "var(--space-md) var(--space-lg)" }}>
      {/* Back breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-xs)" }}>
        <Link href="/actions" className="btn btn--secondary btn--sm" style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", fontSize: "13px" }}>
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M13.5 16.5 L7 10 L13.5 3.5" />
          </svg>
          Back to Actions
        </Link>
        <span className={`status status--${status === "completed" ? "ok" : status === "cancelled" ? "neutral" : "info"}`}>
          Action ID: {action.id.substring(0, 8)}...
        </span>
      </div>

      {/* Notifications */}
      {error && (
        <div className="alert alert--risk" style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", fontSize: "14px" }}>
          <strong>Error:</strong> {error}
        </div>
      )}
      {success && (
        <div className="alert alert--ok" style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", fontSize: "14px" }}>
          <strong>Success:</strong> {success}
        </div>
      )}

      {/* Snoozed Banner */}
      {isSnoozed && (
        <div className="alert alert--accent" style={{ padding: "16px", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-md)", background: "var(--colour-surface-secondary)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-md)" }}>
          <div>
            <h4 style={{ fontWeight: 600, fontSize: "14px", color: "var(--colour-text-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="status status--warn" style={{ fontSize: "10px", padding: "1px 6px", textTransform: "uppercase" }}>Snoozed</span>
              Commitment Snoozed until {formatDateString(action.snoozedUntil!)}
            </h4>
            {action.snoozeMetadata?.last_snooze?.reason && (
              <p style={{ fontSize: "13px", color: "var(--colour-text-secondary)", fontStyle: "italic", marginTop: "6px" }}>
                &ldquo;{action.snoozeMetadata.last_snooze.reason}&rdquo;
              </p>
            )}
          </div>
          <button type="button" onClick={handleClearSnooze} disabled={isSnoozePending} className="btn btn--secondary btn--sm">
            {isSnoozePending ? "Clearing..." : "Un-snooze Action"}
          </button>
        </div>
      )}

      {/* 2-Column Grid */}
      <div className="detail-workspace-grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: "var(--space-lg)" }}>
        {/* LEFT COLUMN: Content, Sources, Snooze Logs, Document Manager */}
        <div className="stack" style={{ gap: "var(--space-lg)" }}>
          {/* Main Details Card */}
          <div className="panel" style={{ background: "var(--colour-surface-secondary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-md)", padding: "var(--space-lg)" }}>
            <form onSubmit={handleSaveDetails} className="stack" style={{ gap: "var(--space-md)" }}>
              <div className="field">
                <label htmlFor="action-title-input" className="field__label" style={{ fontWeight: 600, fontSize: "13px", color: "var(--colour-text-secondary)" }}>Action Title</label>
                <input
                  id="action-title-input"
                  type="text"
                  className="input"
                  style={{ fontSize: "20px", fontWeight: 600, padding: "12px 16px", width: "100%", background: "var(--colour-surface-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", color: "var(--colour-text-primary)" }}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={isPending}
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="action-desc-input" className="field__label" style={{ fontWeight: 600, fontSize: "13px", color: "var(--colour-text-secondary)" }}>Description & Objectives</label>
                <textarea
                  id="action-desc-input"
                  className="input"
                  style={{ width: "100%", minHeight: "150px", resize: "vertical", fontFamily: "inherit", padding: "12px 16px", background: "var(--colour-surface-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", color: "var(--colour-text-primary)", fontSize: "14px", lineHeight: "1.6" }}
                  placeholder="Provide context, deliverables, expectations or exact notes..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isPending}
                  rows={6}
                />
              </div>

              <div className="field">
                <label htmlFor="action-rationale-input" className="field__label" style={{ fontWeight: 600, fontSize: "13px", color: "var(--colour-text-secondary)" }}>Source & Context Notes</label>
                <input
                  id="action-rationale-input"
                  type="text"
                  className="input"
                  style={{ width: "100%", padding: "12px 16px", background: "var(--colour-surface-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", color: "var(--colour-text-primary)", fontSize: "14px" }}
                  placeholder="Provide reference origins, e.g. discussed with Maria in weekly 1:1, or direct workspace URL link..."
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  disabled={isPending}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid var(--colour-border)", paddingTop: "var(--space-md)", marginTop: "var(--space-sm)" }}>
                <button type="submit" className="btn btn--primary" disabled={isPending} style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: "140px" }}>
                  {isPending ? "Saving..." : detailsSaved ? "✓ Saved" : "Save Details"}
                </button>
              </div>
            </form>
          </div>

          {/* Secure Document Attachment Card */}
          <div className="panel" style={{ background: "var(--colour-surface-secondary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-md)", padding: "var(--space-lg)" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, color: "var(--colour-text-primary)", marginBottom: "4px" }}>Document Attachments</h3>
            <p style={{ fontSize: "13px", color: "var(--colour-text-muted)", marginBottom: "var(--space-md)" }}>
              Upload relevant agreements, briefs, or assets required to execute this action. Strictly secure under your tenant workspace boundaries.
            </p>

            {/* Existing Documents List */}
            {action.documents && action.documents.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "var(--space-md)" }}>
                {action.documents.map((doc: any) => (
                  <div key={doc.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "var(--colour-surface-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", borderRadius: "4px", background: "var(--colour-border)", color: "var(--colour-text-secondary)" }}>
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <button
                          type="button"
                          onClick={() => handleDownloadFile(doc.path, doc.name)}
                          style={{ background: "transparent", border: 0, padding: 0, fontWeight: 500, fontSize: "14px", color: "var(--colour-accent-primary)", textAlign: "left", cursor: "pointer", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}
                          title="Click to download"
                        >
                          {doc.name}
                        </button>
                        <p style={{ fontSize: "11px", color: "var(--colour-text-muted)", marginTop: "2px" }}>
                          {formatBytes(doc.size)} • Uploaded {formatDateString(doc.uploadedAt)} by {doc.uploadedBy.split("@")[0]}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteFile(doc.id)}
                      className="btn btn--ghost"
                      style={{ padding: "6px", color: "var(--colour-danger)" }}
                      title="Remove attachment"
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px", background: "var(--colour-surface-primary)", border: "1px dashed var(--colour-border)", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-md)" }}>
                <p style={{ fontSize: "13px", color: "var(--colour-text-muted)" }}>No documents uploaded yet.</p>
              </div>
            )}

            {/* Upload Area */}
            <div style={{ position: "relative" }}>
              <input
                id="doc-upload-input"
                type="file"
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", zIndex: 10 }}
                onChange={handleFileUpload}
                disabled={isUploadPending}
              />
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px", background: "rgba(255, 255, 255, 0.02)", border: "1px dashed var(--colour-border)", borderRadius: "var(--radius-sm)", cursor: "pointer" }}>
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: "var(--colour-accent-primary)", marginBottom: "8px" }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <p style={{ fontSize: "14px", fontWeight: 500, color: "var(--colour-text-primary)" }}>
                  {isUploadPending ? "Uploading file..." : "Click or drag file here to upload"}
                </p>
                <p style={{ fontSize: "11px", color: "var(--colour-text-muted)", marginTop: "4px" }}>
                  Max file size: 15MB. Supported formats: PDF, images, text documents.
                </p>
              </div>
            </div>

            {isUploadPending && uploadProgress !== null && (
              <div style={{ marginTop: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ fontSize: "12px", color: "var(--colour-text-secondary)" }}>Uploading file...</span>
                  <span className="mono" style={{ fontSize: "12px", color: "var(--colour-text-secondary)" }}>{uploadProgress}%</span>
                </div>
                <div style={{ width: "100%", height: "4px", background: "var(--colour-border)", borderRadius: "2px", overflow: "hidden" }}>
                  <div style={{ width: "100%", height: "100%", background: "var(--colour-accent-primary)", transform: `scaleX(${uploadProgress / 100})`, transformOrigin: "left", transition: "transform 0.2s ease" }} />
                </div>
              </div>
            )}
          </div>

          {/* Traceable Sources */}
          {action.references && action.references.length > 0 && (
            <div className="panel" style={{ background: "var(--colour-surface-secondary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-md)", padding: "var(--space-lg)" }}>
              <h3 style={{ fontSize: "16px", fontWeight: 600, color: "var(--colour-text-primary)", marginBottom: "4px" }}>Sources & Traceability</h3>
              <p style={{ fontSize: "13px", color: "var(--colour-text-muted)", marginBottom: "var(--space-md)" }}>
                This commitment was extracted from the following interaction logs or signals:
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {action.references.map((reference) => (
                  <div key={reference.id} style={{ border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", padding: "var(--space-md)", background: "var(--colour-surface-primary)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-xs)", fontSize: "11px", color: "var(--colour-text-secondary)", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>
                      <span>{reference.sourceSystem.replaceAll("_", " ")}</span>
                      {reference.itemTimestamp && (
                        <time dateTime={reference.itemTimestamp}>
                          {formatDateString(reference.itemTimestamp)}
                        </time>
                      )}
                    </div>
                    {reference.excerptOrPointer ? (
                      <p style={{ fontSize: "13px", color: "var(--colour-text-primary)", whiteSpace: "pre-wrap", lineHeight: "1.5" }}>{reference.excerptOrPointer}</p>
                    ) : (
                      <p style={{ fontSize: "13px", color: "var(--colour-text-muted)" }}>Traceability reference ID logged securely.</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Activity / Snooze & Completion History */}
          <div className="panel" style={{ background: "var(--colour-surface-secondary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-md)", padding: "var(--space-lg)" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, color: "var(--colour-text-primary)", marginBottom: "var(--space-sm)" }}>History & Lifecycle Logs</h3>

            <div className="stack" style={{ gap: "12px" }}>
              <div style={{ display: "flex", gap: "12px" }}>
                <span className="mono" style={{ fontSize: "12px", color: "var(--colour-text-muted)", minWidth: "120px" }}>
                  {formatDateString(action.createdAt)}
                </span>
                <div>
                  <p style={{ fontSize: "13px", color: "var(--colour-text-primary)", fontWeight: 500 }}>Commitment Created</p>
                  <p style={{ fontSize: "12px", color: "var(--colour-text-muted)" }}>
                    Source: {action.createdFrom === "manual" ? "Manually captured" : "AI pipeline extraction"}
                  </p>
                </div>
              </div>

              {/* Snooze history logs */}
              {action.snoozeMetadata?.history?.map((snooze: any, index: number) => (
                <div key={`${snooze.snoozed_at}-${index}`} style={{ display: "flex", gap: "12px" }}>
                  <span className="mono" style={{ fontSize: "12px", color: "var(--colour-text-muted)", minWidth: "120px" }}>
                    {formatDateString(snooze.snoozed_at)}
                  </span>
                  <div>
                    <p style={{ fontSize: "13px", color: "var(--colour-text-primary)", fontWeight: 500 }}>Snoozed Commitment</p>
                    <p style={{ fontSize: "12px", color: "var(--colour-text-secondary)" }}>
                      Rescheduled until <strong>{formatDateString(snooze.snoozed_until)}</strong>
                    </p>
                    <p style={{ fontSize: "12px", color: "var(--colour-text-muted)", fontStyle: "italic", marginTop: "2px" }}>
                      &ldquo;{snooze.reason}&rdquo;
                    </p>
                  </div>
                </div>
              ))}

              {/* Completion history */}
              {action.status === "completed" && action.completedAt && (
                <div style={{ display: "flex", gap: "12px" }}>
                  <span className="mono" style={{ fontSize: "12px", color: "var(--colour-text-muted)", minWidth: "120px" }}>
                    {formatDateString(action.completedAt)}
                  </span>
                  <div>
                    <p style={{ fontSize: "13px", color: "var(--colour-success)", fontWeight: 600 }}>✓ Marked Completed</p>
                    {action.completionMetadata?.feedback && (
                      <p style={{ fontSize: "12px", color: "var(--colour-text-muted)", fontStyle: "italic", marginTop: "2px" }}>
                        &ldquo;{action.completionMetadata.feedback}&rdquo;
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Metadata Control Rail */}
        <div className="stack" style={{ gap: "var(--space-lg)" }}>
          {/* Main Controls Card */}
          <div className="panel" style={{ background: "var(--colour-surface-secondary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-md)", padding: "var(--space-lg)" }}>
            <h3 style={{ fontSize: "14px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--colour-text-secondary)", marginBottom: "var(--space-md)" }}>
              Commitment Properties
            </h3>

            <div className="stack" style={{ gap: "var(--space-md)" }}>
              {/* Status Select */}
              <div className="field">
                <label htmlFor="detail-status" className="field__label">Lifecycle Status</label>
                <select
                  id="detail-status"
                  className="input"
                  style={{ width: "100%", background: "var(--colour-surface-primary)", color: "var(--colour-text-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", padding: "8px 12px" }}
                  value={status}
                  onChange={(e) => {
                    const nextVal = e.target.value as ActionStatus;
                    setStatus(nextVal);
                    triggerMetadataUpdate({ status: nextVal });
                  }}
                >
                  <option value="inbox">Inbox (Unorganized)</option>
                  <option value="planned">Planned (Scheduled)</option>
                  <option value="in_progress">In Progress (Active)</option>
                  <option value="waiting">Waiting On Someone</option>
                  <option value="follow_up">Follow-up Needed</option>
                  <option value="completed">Completed (Closed)</option>
                  <option value="cancelled">Cancelled (Dismissed)</option>
                </select>
              </div>

              {/* Priority Select */}
              <div className="field">
                <label htmlFor="detail-priority" className="field__label">Priority Rank</label>
                <select
                  id="detail-priority"
                  className="input"
                  style={{ width: "100%", background: "var(--colour-surface-primary)", color: "var(--colour-text-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", padding: "8px 12px" }}
                  value={priority}
                  onChange={(e) => {
                    const nextVal = e.target.value as ActionPriority;
                    setPriority(nextVal);
                    triggerMetadataUpdate({ priority: nextVal });
                  }}
                >
                  <option value="low">Low Priority</option>
                  <option value="normal">Normal Priority</option>
                  <option value="high">High Priority</option>
                  <option value="critical">Critical (Blocker)</option>
                </select>
              </div>

              {/* Due Date */}
              <div className="field">
                <label htmlFor="detail-due" className="field__label">Operational Due Date</label>
                <div style={{ display: "flex", gap: "6px" }}>
                  <input
                    id="detail-due"
                    type="date"
                    className="input"
                    style={{ flex: 1, background: "var(--colour-surface-primary)", color: "var(--colour-text-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", padding: "8px 12px" }}
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
                      className="btn btn--secondary"
                      style={{ padding: "8px 12px" }}
                      title="Clear due date"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Follow-up Date */}
              <div className="field">
                <label htmlFor="detail-followup" className="field__label">Soft Follow-up Date</label>
                <div style={{ display: "flex", gap: "6px" }}>
                  <input
                    id="detail-followup"
                    type="date"
                    className="input"
                    style={{ flex: 1, background: "var(--colour-surface-primary)", color: "var(--colour-text-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", padding: "8px 12px" }}
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
                      className="btn btn--secondary"
                      style={{ padding: "8px 12px" }}
                      title="Clear follow-up date"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* People & Accountability Link */}
          <div className="panel" style={{ background: "var(--colour-surface-secondary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-md)", padding: "var(--space-lg)" }}>
            <h3 style={{ fontSize: "14px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--colour-text-secondary)", marginBottom: "var(--space-md)" }}>
              Accountability Link
            </h3>
            <p style={{ fontSize: "12px", color: "var(--colour-text-muted)", marginBottom: "var(--space-sm)" }}>
              Assign responsibility or link the primary contact related to this commitment.
            </p>

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
          </div>

          {/* Topics Tagging Card */}
          <div className="panel" style={{ background: "var(--colour-surface-secondary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-md)", padding: "var(--space-lg)" }}>
            <h3 style={{ fontSize: "14px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--colour-text-secondary)", marginBottom: "var(--space-md)" }}>
              Topics & Focus Areas
            </h3>

            <div className="stack" style={{ gap: "var(--space-xs)" }}>
              {topics.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
                  {topics.map((tag) => (
                    <span key={tag} className="chip chip--accent" style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px", fontSize: "12px" }}>
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTopic(tag)}
                        style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", fontSize: "14px", fontWeight: "bold" }}
                        title={`Remove topic ${tag}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: "12px", color: "var(--colour-text-muted)", marginBottom: "8px" }}>No focus areas linked.</p>
              )}

              {/* Suggestions dropdown or matching list */}
              {newTopic.trim() && (
                <div style={{ background: "var(--colour-surface-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", maxHeight: "150px", overflowY: "auto", marginBottom: "8px" }}>
                  {existingTopics
                    .filter((t) => t.toLowerCase().includes(newTopic.toLowerCase()) && !topics.includes(t))
                    .map((matched) => (
                      <button
                        key={matched}
                        type="button"
                        onClick={() => handleAddTopic(matched)}
                        style={{ display: "block", width: "100%", padding: "8px 12px", textAlign: "left", fontSize: "13px", color: "var(--colour-text-primary)", background: "transparent", border: 0, cursor: "pointer", borderBottom: "1px solid var(--colour-border)" }}
                      >
                        Use existing: <strong>{matched}</strong>
                      </button>
                    ))}
                  {!topics.includes(newTopic.trim()) && (
                    <button
                      type="button"
                      onClick={() => handleAddTopic(newTopic)}
                      style={{ display: "block", width: "100%", padding: "8px 12px", textAlign: "left", fontSize: "13px", color: "var(--colour-accent-primary)", background: "transparent", border: 0, cursor: "pointer" }}
                    >
                      + Create new topic: <strong>&ldquo;{newTopic.trim()}&rdquo;</strong>
                    </button>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  type="text"
                  className="input"
                  style={{ flex: 1, fontSize: "13px", padding: "6px 10px" }}
                  placeholder="Type a topic name..."
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTopic(newTopic);
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={!newTopic.trim()}
                  onClick={() => handleAddTopic(newTopic)}
                  style={{ padding: "6px 12px", fontSize: "13px" }}
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          {/* Snooze Control Panel */}
          {status !== "completed" && status !== "cancelled" && !isSnoozed && (
            <div className="panel" style={{ background: "var(--colour-surface-secondary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-md)", padding: "var(--space-lg)" }}>
              <h3 style={{ fontSize: "14px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--colour-text-secondary)", marginBottom: "var(--space-md)" }}>
                Snooze Commitment
              </h3>

              <form onSubmit={handleSnoozeSubmit} className="stack" style={{ gap: "var(--space-sm)" }}>
                <div className="field">
                  <label htmlFor="snooze-until-input" className="field__label">Snooze until date</label>
                  <input
                    id="snooze-until-input"
                    type="date"
                    className="input"
                    style={{ width: "100%", background: "var(--colour-surface-primary)", color: "var(--colour-text-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", padding: "8px 12px" }}
                    value={snoozeUntil}
                    onChange={(e) => setSnoozeUntil(e.target.value)}
                    disabled={isSnoozePending}
                    required
                  />
                  <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      style={{ fontSize: "12px", padding: "4px 8px" }}
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
                      style={{ fontSize: "12px", padding: "4px 8px" }}
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
                  <label htmlFor="snooze-reason-input" className="field__label">Snooze Reason</label>
                  <input
                    id="snooze-reason-input"
                    type="text"
                    className="input"
                    style={{ width: "100%", background: "var(--colour-surface-primary)", color: "var(--colour-text-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", padding: "8px 12px" }}
                    placeholder="e.g. Waiting for team alignment..."
                    value={snoozeReason}
                    onChange={(e) => setSnoozeReason(e.target.value)}
                    disabled={isSnoozePending}
                  />
                </div>

                <button type="submit" className="btn btn--secondary" style={{ width: "100%", marginTop: "4px" }} disabled={isSnoozePending || !snoozeUntil}>
                  {isSnoozePending ? "Snoozing..." : "Apply Snooze"}
                </button>
              </form>
            </div>
          )}

          {/* Complete Action Section */}
          {status !== "completed" && (
            <div className="panel" style={{ background: "var(--colour-surface-secondary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-md)", padding: "var(--space-lg)" }}>
              <h3 style={{ fontSize: "14px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--colour-text-secondary)", marginBottom: "var(--space-md)" }}>
                Complete Action
              </h3>

              <form onSubmit={handleCompleteSubmit} className="stack" style={{ gap: "var(--space-sm)" }}>
                <div className="field">
                  <label htmlFor="completion-feedback-input" className="field__label">Closure Notes (Optional)</label>
                  <input
                    id="completion-feedback-input"
                    type="text"
                    className="input"
                    style={{ width: "100%", background: "var(--colour-surface-primary)", color: "var(--colour-text-primary)", border: "1px solid var(--colour-border)", borderRadius: "var(--radius-sm)", padding: "8px 12px" }}
                    placeholder="e.g. Client signed off hiring pipeline..."
                    value={completionFeedback}
                    onChange={(e) => setCompletionFeedback(e.target.value)}
                    disabled={isCompletePending}
                  />
                </div>

                <button type="submit" className="btn btn--accent-outline" style={{ width: "100%", marginTop: "4px" }} disabled={isCompletePending}>
                  {isCompletePending ? "Completing..." : "✓ Mark as Completed"}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Style tag to support the responsive layout */}
      <style jsx global>{`
        @media (min-width: 1024px) {
          .detail-workspace-grid {
            grid-template-columns: 2fr 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
