"use client";

/**
 * Client interactivity for the Diary surface (ADR-041). The composer is a
 * guided, low-friction capture box: a greeting and a small set of optional,
 * time-aware prompts suggest where to start, and a single lightweight entry
 * type keeps each entry findable. The timeline groups entries by day and offers
 * a type filter and keyword search. All persistence happens through the server
 * actions in ./actions; this component holds only ephemeral UI state.
 *
 * The Diary is private by default (product/diary.md): entries are visible only
 * to their author and are not fed to any agent unless the operator opts in.
 * Voice capture, linking, and meaning-based search are designed but not in this
 * phase — they appear as clearly non-interactive "coming soon" affordances.
 */

import {
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import {
  createEntryAction,
  updateEntryAction,
  deleteEntryAction,
} from "./actions";
import {
  DEFAULT_DIARY_ENTRY_TYPE,
  DIARY_ENTRY_TYPES,
  DIARY_TYPE_META,
  initialDiaryFormState,
  type DiaryEntryType,
} from "./types";
import { AVAILABILITY_LABELS } from "@/modules/shared/availability";

/** Plain, serialisable shape passed from the server component. */
export interface DiaryEntryView {
  id: string;
  entryType: DiaryEntryType;
  body: string | null;
  createdAt: string;
  updatedAt: string;
}

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});
const timeFormat = new Intl.DateTimeFormat("en-GB", { timeStyle: "short" });
const dayFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "full" });

function parse(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A small, time-aware prompt: its label is both the chip and the placeholder. */
interface Prompt {
  label: string;
  type: DiaryEntryType;
}

type Period = "default" | "morning" | "afternoon" | "evening";

const GREETING: Record<Period, string> = {
  default: "Capture your day:",
  morning: "Good morning. Set up your day:",
  afternoon: "How’s the day going?",
  evening: "Closing the day:",
};

const PROMPTS: Record<Period, Prompt[]> = {
  default: [
    { label: "What’s on your mind?", type: "note" },
    { label: "What did you decide?", type: "decision" },
    { label: "What needs follow-up?", type: "follow_up" },
  ],
  morning: [
    { label: "What matters most today?", type: "note" },
    { label: "What are you focused on?", type: "note" },
    { label: "Any meetings to prepare for?", type: "meeting" },
  ],
  afternoon: [
    { label: "What’s moved since this morning?", type: "note" },
    { label: "Any decisions you’ve made?", type: "decision" },
    { label: "What’s blocking you?", type: "risk" },
  ],
  evening: [
    { label: "What happened today?", type: "note" },
    { label: "What did you decide?", type: "decision" },
    { label: "What needs follow-up?", type: "follow_up" },
    { label: "What did you learn?", type: "reflection" },
    { label: "What still feels unresolved?", type: "risk" },
  ],
};

function periodFor(hour: number): Period {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

// Read a client-only flag without a setState-in-effect: the server snapshot is
// false and the client snapshot is the constant true, so it flips exactly once
// on hydration and never trips the cached-snapshot guard.
const subscribeNoop = () => () => {};
function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

/** Small de-pilled chip showing an entry's type, in its muted tone. */
function TypeChip({ type }: { type: DiaryEntryType }) {
  const meta = DIARY_TYPE_META[type];
  return <span className={`status status--${meta.tone}`}>{meta.label}</span>;
}

/** The microphone glyph for the (disabled) voice affordance. */
function MicIcon() {
  return (
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
  );
}

/** Composer: greeting, guided prompts, type selector, and a one-line capture. */
export function DiaryComposer() {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [type, setType] = useState<DiaryEntryType>(DEFAULT_DIARY_ENTRY_TYPE);
  const [placeholder, setPlaceholder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Resolve the time of day on the client only, so the server-rendered greeting
  // ("default") matches on hydration and then settles to the local time of day.
  const isClient = useIsClient();
  const period = useMemo<Period>(
    () => (isClient ? periodFor(new Date().getHours()) : "default"),
    [isClient],
  );

  function choosePrompt(prompt: Prompt) {
    setType(prompt.type);
    setPlaceholder(prompt.label);
    textareaRef.current?.focus();
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createEntryAction(initialDiaryFormState, formData);
      if (result.ok) {
        setError(null);
        setType(DEFAULT_DIARY_ENTRY_TYPE);
        setPlaceholder(null);
        formRef.current?.reset();
      } else {
        setError(result.error ?? "Could not save your entry.");
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="card">
      <div className="card-head">
        <p className="eyebrow">{GREETING[period]}</p>
        <span className="status status--neutral">Private</span>
      </div>

      <div className="diary-prompts">
        {PROMPTS[period].map((prompt) => (
          <button
            key={prompt.label}
            type="button"
            className={`diary-prompt${
              placeholder === prompt.label ? " diary-prompt--active" : ""
            }`}
            onClick={() => choosePrompt(prompt)}
          >
            {prompt.label}
          </button>
        ))}
      </div>

      <textarea
        id="diary-body"
        ref={textareaRef}
        name="body"
        rows={4}
        required
        placeholder={placeholder ?? "Write a line…"}
        className="textarea"
      />
      <input type="hidden" name="entryType" value={type} />

      {error ? (
        <p className="form-message form-message--error">{error}</p>
      ) : null}

      <div className="diary-composer__controls">
        <label className="diary-type-field">
          <span className="field__label">Type</span>
          <select
            className="input diary-type-select"
            value={type}
            onChange={(event) => setType(event.target.value as DiaryEntryType)}
          >
            {DIARY_ENTRY_TYPES.map((value) => (
              <option key={value} value={value}>
                {DIARY_TYPE_META[value].label}
              </option>
            ))}
          </select>
        </label>

        <div className="diary-composer__actions">
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-sm)",
            }}
          >
            <button
              type="button"
              className="btn btn--ghost"
              disabled
              title="Voice capture is coming soon."
            >
              <MicIcon />
              Record voice note
            </button>
            <span className="status status--neutral">
              {AVAILABILITY_LABELS.coming_soon}
            </span>
          </span>
          <button type="submit" className="btn btn--primary" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </form>
  );
}

/** A single entry: read view with edit/delete, or an inline edit form. */
function DiaryEntryItem({ entry }: { entry: DiaryEntryView }) {
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<DiaryEntryType>(entry.entryType);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const created = parse(entry.createdAt);
  const edited = entry.updatedAt !== entry.createdAt;

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

  function cancelEdit() {
    setEditing(false);
    setType(entry.entryType);
    setError(null);
  }

  return (
    <li className="diary-entry">
      <div className="diary-entry__meta">
        <span>{created ? timeFormat.format(created) : entry.createdAt}</span>
        {edited ? <span>&middot; edited</span> : null}
        <TypeChip type={editing ? type : entry.entryType} />
      </div>

      {editing ? (
        <form onSubmit={handleEditSubmit}>
          <input type="hidden" name="id" value={entry.id} />
          <input type="hidden" name="prevEntryType" value={entry.entryType} />
          <input type="hidden" name="entryType" value={type} />
          <textarea
            name="body"
            rows={4}
            required
            defaultValue={entry.body ?? ""}
            className="textarea"
          />
          <div className="diary-entry__edit-row">
            <label className="diary-type-field">
              <span className="field__label">Type</span>
              <select
                className="input diary-type-select"
                value={type}
                onChange={(event) =>
                  setType(event.target.value as DiaryEntryType)
                }
              >
                {DIARY_ENTRY_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {DIARY_TYPE_META[value].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
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
              onClick={cancelEdit}
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
            <button
              type="button"
              className="btn btn--ghost"
              disabled
              title="Linking entries to decisions, people, and actions is coming soon."
            >
              Link
            </button>
            <form
              action={deleteEntryAction}
              onSubmit={(event) => {
                if (
                  !window.confirm(
                    "Delete this entry? This can’t be undone.",
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

/** Build the relative day label for a group ("Today" / "Yesterday" / date). */
function dayLabel(date: Date, now: number | null): string {
  if (now === null) return dayFormat.format(date);
  const startOf = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const diffDays = Math.round(
    (startOf(now) - startOf(date.getTime())) / 86_400_000,
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return dayFormat.format(date);
}

/** Filter + search + day-grouped timeline of the author's entries. */
export function DiaryTimeline({ entries }: { entries: DiaryEntryView[] }) {
  const [filter, setFilter] = useState<DiaryEntryType | "all">("all");
  const [query, setQuery] = useState("");

  // Resolve "now" on the client only so Today/Yesterday labels match on SSR
  // (the server renders absolute dates; the client relabels after hydration).
  const isClient = useIsClient();
  const now = useMemo(() => (isClient ? new Date().getTime() : null), [isClient]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter !== "all" && entry.entryType !== filter) return false;
      if (q && !(entry.body ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, filter, query]);

  // Group the (already newest-first) entries into ordered day buckets.
  const groups = useMemo(() => {
    const out: { key: string; label: string; items: DiaryEntryView[] }[] = [];
    let current: (typeof out)[number] | null = null;
    for (const entry of filtered) {
      const date = parse(entry.createdAt);
      const key = date ? date.toDateString() : entry.createdAt;
      if (!current || current.key !== key) {
        current = {
          key,
          label: date ? dayLabel(date, now) : entry.createdAt,
          items: [],
        };
        out.push(current);
      }
      current.items.push(entry);
    }
    return out;
  }, [filtered, now]);

  const hasEntries = entries.length > 0;
  const filtering = filter !== "all" || query.trim().length > 0;

  return (
    <div className="diary-timeline">
      <div className="diary-timeline__head">
        <p className="eyebrow">Timeline</p>
        {hasEntries ? (
          <input
            type="search"
            className="input diary-search"
            placeholder="Search entries"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        ) : null}
      </div>

      {hasEntries ? (
        <div className="segmented diary-filter" role="group" aria-label="Filter by type">
          <button
            type="button"
            className={`segmented__option${
              filter === "all" ? " segmented__option--active" : ""
            }`}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          {DIARY_ENTRY_TYPES.map((value) => (
            <button
              key={value}
              type="button"
              className={`segmented__option${
                filter === value ? " segmented__option--active" : ""
              }`}
              onClick={() => setFilter(value)}
            >
              {DIARY_TYPE_META[value].label}
            </button>
          ))}
        </div>
      ) : null}

      {!hasEntries ? (
        <div className="empty" style={{
          marginTop: "var(--space-lg)",
          padding: "var(--space-xl) var(--space-md)",
          borderRadius: "var(--radius-md)",
          border: "1px solid rgba(255, 255, 255, 0.05)",
          background: "rgba(255, 255, 255, 0.01)",
          textAlign: "center"
        }}>
          <p className="empty__title" style={{
            fontWeight: 600,
            color: "var(--colour-text-primary)",
            fontSize: "var(--text-body)",
            letterSpacing: "-0.01em"
          }}>
            Start your private diary
          </p>
          <p className="empty__body" style={{
            color: "var(--colour-text-secondary)",
            fontSize: "var(--text-small)",
            maxWidth: "480px",
            margin: "var(--space-sm) auto 0",
            lineHeight: "var(--leading-normal)"
          }}>
            This is your private space to keep a record of your day &mdash; the
            decisions you make, what you&rsquo;re acting on, and the things still
            on your mind. A line a day is enough. Over time it becomes a memory of
            how your thinking changed.
          </p>
          <p className="empty__body" style={{
            color: "var(--colour-accent)",
            fontSize: "var(--text-small)",
            fontWeight: 500,
            marginTop: "var(--space-md)"
          }}>
            Pick a prompt above, or just write your first line.
          </p>
        </div>
      ) : groups.length === 0 ? (
        <div className="empty" style={{
          marginTop: "var(--space-lg)",
          padding: "var(--space-lg) var(--space-md)",
          borderRadius: "var(--radius-md)",
          border: "1px dashed var(--colour-border)",
          textAlign: "center"
        }}>
          <p className="empty__title" style={{ fontWeight: 500, color: "var(--colour-text-primary)" }}>No entries match</p>
          <p className="empty__body" style={{ color: "var(--colour-text-muted)", fontSize: "var(--text-small)", marginTop: "4px" }}>Clear the filter to see everything.</p>
        </div>
      ) : (
        <div className="diary-days">
          {groups.map((group) => (
            <section key={group.key} className="diary-day">
              <p className="diary-day__label">{group.label}</p>
              <ul className="stack">
                {group.items.map((entry) => (
                  <DiaryEntryItem key={entry.id} entry={entry} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
