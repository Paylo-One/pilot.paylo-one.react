"use client";

/**
 * Client interactivity for the Diary surface. Renders a composer for new
 * entries and a reverse-chronological timeline where each entry can be edited
 * inline or deleted. All persistence happens through the server actions in
 * ./actions; this component holds only ephemeral UI state.
 *
 * The Diary is private by default (product/diary.md): entries are visible only
 * to their author and are not fed to any agent unless the operator opts in.
 * Voice capture + transcription are designed entry types shown here as clearly
 * scaffolded affordances — they do not record or transcribe in this build.
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
} from "./actions";
import { initialDiaryFormState } from "./types";

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

/** Composer: create a new private text entry, with voice capture scaffolded. */
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
    <form ref={formRef} action={action} className="card">
      <div className="card-head">
        <p className="eyebrow">New reflection</p>
        <span className="status status--neutral">Private</span>
      </div>
      <textarea
        id="diary-body"
        name="body"
        rows={4}
        required
        placeholder="Capture a decision, the rationale behind it, or a thought…"
        className="textarea"
      />
      {state.error ? (
        <p className="form-message form-message--error">{state.error}</p>
      ) : null}
      <div
        style={{
          marginTop: "var(--space-md)",
          display: "flex",
          gap: "var(--space-sm)",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button type="submit" className="btn btn--primary" disabled={pending}>
          {pending ? "Saving…" : "Save entry"}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled
          title="Voice capture + transcription — designed, not yet wired in this scaffold"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
          </svg>
          Record voice note
        </button>
        <span className="field__hint">
          Voice notes transcribe alongside the audio. Audio retention follows
          your storage policy.
        </span>
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
    <li className="diary-entry">
      <div className="diary-entry__meta">
        <span>{formatTimestamp(entry.createdAt)}</span>
        {edited ? <span>· edited</span> : null}
        <span className="status status--neutral" style={{ marginLeft: "auto" }}>
          Private
        </span>
      </div>

      {editing ? (
        <form onSubmit={handleEditSubmit}>
          <input type="hidden" name="id" value={entry.id} />
          <textarea
            name="body"
            rows={4}
            required
            defaultValue={entry.body ?? ""}
            className="textarea"
          />
          {error ? (
            <p className="form-message form-message--error">{error}</p>
          ) : null}
          <div className="diary-entry__controls">
            <button type="submit" className="btn btn--primary" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
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
          <p className="diary-entry__body">{entry.body}</p>
          <div className="diary-entry__controls">
            <button
              type="button"
              className="btn btn--ghost"
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
              <button type="submit" className="btn btn--ghost">
                Delete
              </button>
            </form>
          </div>
        </>
      )}
    </li>
  );
}

/** The reverse-chronological timeline of the author's entries. */
export function DiaryList({ entries }: { entries: DiaryEntryView[] }) {
  if (entries.length === 0) {
    return (
      <div className="empty" style={{ marginTop: "var(--space-lg)" }}>
        <p className="empty__title">No entries yet</p>
        <p className="empty__body">
          Your reflections are private to you. Capture the first one above.
        </p>
      </div>
    );
  }

  return (
    <ul
      className="stack"
      style={{ marginTop: "var(--space-lg)" }}
    >
      {entries.map((entry) => (
        <DiaryEntryItem key={entry.id} entry={entry} />
      ))}
    </ul>
  );
}
