"use client";

/**
 * Upload form for the Sources page. Lets the operator paste text (with an
 * optional title) or attach a .txt/.md file. Submits to the `uploadNoteAction`
 * server action via `useActionState`. No external credentials required.
 */

import { useActionState, useEffect, useRef } from "react";
import { uploadNoteAction, type UploadResult } from "./actions";

const INITIAL: UploadResult | null = null;

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  fontSize: "var(--text-body)",
  fontFamily: "var(--font-body)",
  color: "var(--colour-text-primary)",
  background: "var(--colour-surface)",
  border: "1px solid var(--colour-border-strong)",
  borderRadius: "var(--radius-md)",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "var(--text-small)",
  color: "var(--colour-text-secondary)",
  marginBottom: "var(--space-xs)",
};

export function UploadForm() {
  const [state, formAction, pending] = useActionState(uploadNoteAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}
    >
      <div>
        <label htmlFor="source-title" style={labelStyle}>
          Title <span style={{ color: "var(--colour-text-tertiary)" }}>(optional)</span>
        </label>
        <input
          id="source-title"
          name="title"
          type="text"
          placeholder="e.g. Q3 board notes"
          style={fieldStyle}
          disabled={pending}
        />
      </div>

      <div>
        <label htmlFor="source-body" style={labelStyle}>
          Paste text
        </label>
        <textarea
          id="source-body"
          name="body"
          rows={6}
          placeholder="Paste a note, decision, or any context worth keeping…"
          style={{ ...fieldStyle, resize: "vertical", lineHeight: "var(--leading-normal)" }}
          disabled={pending}
        />
      </div>

      <div>
        <label htmlFor="source-file" style={labelStyle}>
          …or attach a .txt / .md file
        </label>
        <input
          id="source-file"
          name="file"
          type="file"
          accept=".txt,.md,.markdown,.text,text/plain,text/markdown"
          style={{ ...fieldStyle, padding: "6px 12px" }}
          disabled={pending}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
        <button
          type="submit"
          disabled={pending}
          style={{
            padding: "8px 20px",
            fontSize: "var(--text-small)",
            fontWeight: 600,
            color: "var(--colour-accent-on)",
            background: "var(--colour-accent)",
            border: "1px solid var(--colour-accent)",
            borderRadius: "var(--radius-md)",
            cursor: pending ? "default" : "pointer",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "Saving\u2026" : "Add to workspace"}
        </button>
        {state ? (
          <span
            role="status"
            style={{
              fontSize: "var(--text-small)",
              color: state.ok ? "var(--colour-accent)" : "var(--colour-text-secondary)",
            }}
          >
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
