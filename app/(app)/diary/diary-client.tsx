"use client";

/**
 * Client interactivity for the Diary surface. Renders a composer for new
 * entries and a reverse-chronological list where each entry can be edited
 * inline or deleted. All persistence happens through the server actions in
 * ./actions; this component holds only ephemeral UI state.
 */

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  createEntryAction,
  updateEntryAction,
  deleteEntryAction,
  initialDiaryFormState,
} from "./actions";

/** Plain, serialisable shape passed from the server component. */
export interface DiaryEntryView {
  id: string;
  body: string | null;
  createdAt: string;
  updatedAt: string;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : dateFormat.format(parsed);
}

const fieldStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--colour-surface)",
  color: "var(--colour-text-primary)",
  border: "1px solid var(--colour-border-strong)",
  borderRadius: "var(--radius-md)",
  padding: "var(--space-sm) var(--space-md)",
  font: "inherit",
  resize: "vertical",
};

const primaryButtonStyle: React.CSSProperties = {
  background: "var(--colour-accent)",
  color: "var(--colour-accent-on)",
  border: "none",
  borderRadius: "var(--radius-md)",
  padding: "var(--space-sm) var(--space-lg)",
  font: "inherit",
  cursor: "pointer",
};

const subtleButtonStyle: React.CSSProperties = {
  background: "none",
  color: "var(--colour-text-secondary)",
  border: "1px solid var(--colour-border)",
  borderRadius: "var(--radius-md)",
  padding: "var(--space-xs) var(--space-md)",
  font: "inherit",
  fontSize: "var(--text-small)",
  cursor: "pointer",
};

const errorStyle: React.CSSProperties = {
  color: "#b4423a",
  fontSize: "var(--text-small)",
  marginTop: "var(--space-xs)",
};

/** Composer: create a new private text entry. */
export function DiaryComposer() {
  const [state, action, pending] = useActionState(
    createEntryAction,
    initialDiaryFormState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="panel">
      <label
        htmlFor="diary-body"
        className="eyebrow"
        style={{ display: "block", marginBottom: "var(--space-sm)" }}
      >
        New reflection
      </label>
      <textarea
        id="diary-body"
        name="body"
        rows={4}
        required
        placeholder="Capture a decision, a rationale, or a thought…"
        style={fieldStyle}
      />
      {state.error ? <p style={errorStyle}>{state.error}</p> : null}
      <div style={{ marginTop: "var(--space-md)" }}>
        <button type="submit" style={primaryButtonStyle} disabled={pending}>
          {pending ? "Saving…" : "Save entry"}
        </button>
      </div>
    </form>
  );
}

/** A single entry: read view with edit/delete, or an inline edit form. */
function DiaryEntryItem({ entry }: { entry: DiaryEntryView }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const edited = entry.updatedAt !== entry.createdAt;

  // Call the server action imperatively so success collapses the editor without
  // a setState-in-effect (which triggers cascading renders).
  function handleEditSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await updateEntryAction(initialDiaryFormState, formData);
      if (result.ok) {
        setError(null);
        setEditing(false);
      } else {
        setError(result.error ?? "Could not save changes.");
      }
    });
  }

  return (
    <li className="panel" style={{ marginBottom: "var(--space-md)" }}>
      <div
        className="mono"
        style={{
          fontSize: "var(--text-label)",
          color: "var(--colour-text-tertiary)",
          marginBottom: "var(--space-sm)",
        }}
      >
        {formatTimestamp(entry.createdAt)}
        {edited ? " · edited" : ""}
      </div>

      {editing ? (
        <form onSubmit={handleEditSubmit}>
          <input type="hidden" name="id" value={entry.id} />
          <textarea
            name="body"
            rows={4}
            required
            defaultValue={entry.body ?? ""}
            style={fieldStyle}
          />
          {error ? <p style={errorStyle}>{error}</p> : null}
          <div
            style={{
              display: "flex",
              gap: "var(--space-sm)",
              marginTop: "var(--space-md)",
            }}
          >
            <button type="submit" style={primaryButtonStyle} disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              style={subtleButtonStyle}
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={pending}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <p style={{ whiteSpace: "pre-wrap" }}>{entry.body}</p>
          <div
            style={{
              display: "flex",
              gap: "var(--space-sm)",
              marginTop: "var(--space-md)",
            }}
          >
            <button
              type="button"
              style={subtleButtonStyle}
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <form
              action={deleteEntryAction}
              onSubmit={(event) => {
                if (
                  !window.confirm(
                    "Delete this diary entry? This cannot be undone.",
                  )
                ) {
                  event.preventDefault();
                }
              }}
            >
              <input type="hidden" name="id" value={entry.id} />
              <button type="submit" style={subtleButtonStyle}>
                Delete
              </button>
            </form>
          </div>
        </>
      )}
    </li>
  );
}

/** The reverse-chronological list of the author's entries. */
export function DiaryList({ entries }: { entries: DiaryEntryView[] }) {
  if (entries.length === 0) {
    return (
      <p
        className="scaffold-note"
        style={{ marginTop: "var(--space-lg)" }}
      >
        No entries yet. Your reflections are private to you.
      </p>
    );
  }

  return (
    <ul style={{ marginTop: "var(--space-lg)" }}>
      {entries.map((entry) => (
        <DiaryEntryItem key={entry.id} entry={entry} />
      ))}
    </ul>
  );
}
