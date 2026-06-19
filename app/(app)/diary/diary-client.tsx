"use client";

/**
 * Client interactivity for the Private Diary surface.
 *
 * The surface prioritises today's capture and the latest weekly recap. The
 * timeline remains browseable, but actions and risks are promoted only by clear
 * operator intent.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import {
  createDiaryFollowUpAction,
  createEntryAction,
  createVoiceEntryAction,
  deleteEntryAction,
  generateWeeklySummaryAction,
  resolveRiskEntryAction,
  transcribeVoiceNoteAction,
  updateEntryAction,
} from "./actions";
import {
  DEFAULT_DIARY_ENTRY_TYPE,
  DIARY_ENTRY_TYPES,
  DIARY_TYPE_META,
  initialDiaryFormState,
  type DiaryEntryType,
} from "./types";

/** Plain, serialisable shape passed from the server component. */
export interface DiaryEntryView {
  id: string;
  kind: "text" | "voice";
  entryType: DiaryEntryType;
  body: string | null;
  transcript: string | null;
  audioStoragePath: string | null;
  audioMimeType: string | null;
  audioDurationSeconds: number | null;
  transcriptionStatus: "none" | "pending" | "done" | "failed";
  riskStatus: "active" | "resolved" | null;
  riskResolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiaryWeeklySummaryView {
  id: string;
  weekStartDate: string;
  keyReflections: string[];
  importantDecisions: string[];
  notableRisks: string[];
  followUpsCreated: string[];
  recurringThemes: string[];
  nextWeekAttention: string[];
  entryCount: number;
  generatedAt: string;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });
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

function displayText(entry: DiaryEntryView): string {
  return entry.transcript || entry.body || "";
}

function clamp(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

/** A small, time-aware prompt: its label is both the chip and the placeholder. */
interface Prompt {
  label: string;
  type: DiaryEntryType;
}

type Period = "default" | "morning" | "afternoon" | "evening";

const GREETING: Record<Period, string> = {
  default: "Capture what matters today.",
  morning: "Set the day up clearly.",
  afternoon: "Record what has moved.",
  evening: "Close the day with a clear record.",
};

const PROMPTS: Record<Period, Prompt[]> = {
  default: [
    { label: "What happened that should be remembered?", type: "note" },
    { label: "What did you decide?", type: "decision" },
    { label: "What needs attention next?", type: "follow_up" },
  ],
  morning: [
    { label: "What matters most today?", type: "note" },
    { label: "What needs a decision?", type: "decision" },
    { label: "What risk needs watching?", type: "risk" },
  ],
  afternoon: [
    { label: "What has changed since this morning?", type: "note" },
    { label: "What did you decide?", type: "decision" },
    { label: "What needs follow-up?", type: "follow_up" },
  ],
  evening: [
    { label: "What happened today?", type: "reflection" },
    { label: "What should not be forgotten?", type: "note" },
    { label: "What still feels unresolved?", type: "risk" },
  ],
};

function periodFor(hour: number): Period {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

const subscribeNoop = () => () => {};
function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

function TypeChip({ type }: { type: DiaryEntryType }) {
  const meta = DIARY_TYPE_META[type];
  return <span className={`status status--${meta.tone}`}>{meta.label}</span>;
}

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

function toAudioFile(blob: Blob): File {
  const type = blob.type || "audio/webm";
  const extension = type.includes("mp4") ? "m4a" : type.includes("wav") ? "wav" : "webm";
  return new File([blob], `diary-voice-note.${extension}`, { type });
}

function VoiceNoteCapture() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [type, setType] = useState<DiaryEntryType>("note");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [transcribing, startTranscribing] = useTransition();

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  async function startRecording() {
    setError(null);
    setNotice(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice recording is not available in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        const nextUrl = URL.createObjectURL(blob);
        previewUrlRef.current = nextUrl;
        setAudioBlob(blob);
        setPreviewUrl(nextUrl);
        setDurationSeconds(
          startedAtRef.current
            ? Math.round((Date.now() - startedAtRef.current) / 1000)
            : 0,
        );
        stream.getTracks().forEach((track) => track.stop());
      };
      mediaRecorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start();
      setTranscript("");
      setAudioBlob(null);
      setPreviewUrl(null);
      setDurationSeconds(0);
      setRecording(true);
    } catch {
      setError("Allow microphone access to record a private voice note.");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  function transcribe() {
    if (!audioBlob) {
      setError("Record a voice note before transcribing.");
      return;
    }
    setError(null);
    setNotice(null);
    const formData = new FormData();
    formData.set("audio", toAudioFile(audioBlob));
    startTranscribing(async () => {
      const result = await transcribeVoiceNoteAction(formData);
      if (result.ok && result.transcript) {
        setTranscript(result.transcript);
        setNotice("Transcript ready. Edit it before saving if needed.");
      } else {
        setError(result.error ?? "Could not transcribe this recording.");
      }
    });
  }

  function saveVoiceNote() {
    if (!audioBlob) {
      setError("Record a voice note before saving.");
      return;
    }
    if (!transcript.trim()) {
      setError("Transcribe the recording or add a short transcript before saving.");
      return;
    }

    const formData = new FormData();
    formData.set("audio", toAudioFile(audioBlob));
    formData.set("transcript", transcript);
    formData.set("body", transcript);
    formData.set("entryType", type);
    formData.set("durationSeconds", String(durationSeconds));

    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await createVoiceEntryAction(initialDiaryFormState, formData);
      if (result.ok) {
        setTranscript("");
        setAudioBlob(null);
        setPreviewUrl(null);
        setDurationSeconds(0);
        setType("note");
        setNotice("Voice note saved to your diary.");
      } else {
        setError(result.error ?? "Could not save this voice note.");
      }
    });
  }

  return (
    <div className="diary-voice">
      <div className="diary-voice__head">
        <div>
          <p className="eyebrow">Voice note</p>
          <p className="diary-helper">
            Capture the thought now. Keep the transcript short, private, and editable.
          </p>
        </div>
        {recording ? (
          <span className="status status--risk">Recording</span>
        ) : (
          <span className="status status--neutral">Private</span>
        )}
      </div>

      <div className="diary-voice__controls">
        {!recording ? (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={startRecording}
            disabled={pending || transcribing}
          >
            <MicIcon />
            Start Recording
          </button>
        ) : (
          <button type="button" className="btn btn--primary" onClick={stopRecording}>
            Stop Recording
          </button>
        )}

        <button
          type="button"
          className="btn btn--ghost"
          onClick={transcribe}
          disabled={!audioBlob || transcribing || pending}
        >
          {transcribing ? "Transcribing…" : "Transcribe Recording"}
        </button>
      </div>

      {previewUrl ? (
        <audio className="diary-voice__audio" src={previewUrl} controls />
      ) : null}

      {audioBlob ? (
        <div className="diary-voice__edit">
          <label className="diary-type-field">
            <span className="field__label">Type</span>
            <select
              className="input diary-type-select"
              value={type}
              onChange={(event) => setType(event.target.value as DiaryEntryType)}
              disabled={pending}
            >
              {DIARY_ENTRY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {DIARY_TYPE_META[value].label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Transcript</span>
            <textarea
              className="textarea"
              rows={4}
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
              placeholder="Edit the transcript before saving…"
            />
          </label>
          <button
            type="button"
            className="btn btn--primary"
            onClick={saveVoiceNote}
            disabled={pending}
          >
            {pending ? "Saving…" : "Save Voice Note"}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="form-message form-message--error" aria-live="polite">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="form-message" aria-live="polite">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

/** Composer: greeting, guided prompts, type selector, text capture, and voice. */
export function DiaryComposer() {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [type, setType] = useState<DiaryEntryType>(DEFAULT_DIARY_ENTRY_TYPE);
  const [placeholder, setPlaceholder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
        setError(result.error ?? "Add a few words before saving.");
      }
    });
  }

  return (
    <section className="diary-capture">
      <form ref={formRef} onSubmit={handleSubmit} className="card diary-capture__text">
        <div className="card-head">
          <div>
            <p className="eyebrow">{GREETING[period]}</p>
            <p className="diary-helper">
              A line is enough. Capture the decision, risk, follow-up, or detail
              that should not disappear.
            </p>
          </div>
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
          rows={5}
          required
          placeholder={placeholder ?? "Write what should be remembered…"}
          className="textarea"
          autoComplete="off"
        />
        <input type="hidden" name="entryType" value={type} />

        {error ? (
          <p className="form-message form-message--error" aria-live="polite">
            {error}
          </p>
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
            <button type="submit" className="btn btn--primary" disabled={pending}>
              {pending ? "Saving…" : "Save Entry"}
            </button>
          </div>
        </div>
      </form>

      <VoiceNoteCapture />
    </section>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="diary-summary__block">
      <h3>{title}</h3>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${title}-${index}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>No clear signal yet.</p>
      )}
    </div>
  );
}

export function WeeklyDiarySummary({
  summaries,
  entryCount,
}: {
  summaries: DiaryWeeklySummaryView[];
  entryCount: number;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const latest = summaries[0] ?? null;
  const generatedAt = latest ? parse(latest.generatedAt) : null;

  function generateSummary() {
    setMessage(null);
    startTransition(async () => {
      const result = await generateWeeklySummaryAction();
      setMessage(
        result.ok
          ? "Weekly summary prepared."
          : result.error ?? "Could not prepare the weekly summary.",
      );
    });
  }

  return (
    <section className="diary-summary">
      <div className="diary-summary__head">
        <div>
          <p className="eyebrow">Weekly summary</p>
          <h2>This week, in one place</h2>
          <p>
            A clean recap of the week&rsquo;s reflections, decisions, risks, and
            follow-ups, so the daily record does not become another feed.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={generateSummary}
          disabled={pending || entryCount === 0}
        >
          {pending ? "Preparing…" : latest ? "Update Summary" : "Prepare Summary"}
        </button>
      </div>

      {message ? (
        <p className="form-message" aria-live="polite">
          {message}
        </p>
      ) : null}

      {latest ? (
        <>
          <p className="diary-summary__meta">
            Week of {dateFormat.format(new Date(`${latest.weekStartDate}T00:00:00`))}
            {generatedAt ? ` · updated ${dateTimeFormat.format(generatedAt)}` : ""}
            {` · ${latest.entryCount} entries`}
          </p>
          <div className="diary-summary__grid">
            <SummaryList title="Key Reflections" items={latest.keyReflections} />
            <SummaryList title="Important Decisions" items={latest.importantDecisions} />
            <SummaryList title="Notable Risks" items={latest.notableRisks} />
            <SummaryList title="Follow-ups Created" items={latest.followUpsCreated} />
            <SummaryList title="Recurring Themes" items={latest.recurringThemes} />
            <SummaryList title="Attention Next Week" items={latest.nextWeekAttention} />
          </div>
        </>
      ) : (
        <p className="diary-empty-note">
          No weekly summary yet. Capture a few entries, then prepare a summary
          when the week has enough signal.
        </p>
      )}
    </section>
  );
}

function suggestedFollowUps(entry: DiaryEntryView): string[] {
  const text = displayText(entry);
  if (!text) return [];
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const matches = sentences.filter((sentence) =>
    /\b(follow[- ]?up|check in|chase|ask|confirm|reply|send|schedule|ping|circle back)\b/i.test(
      sentence,
    ),
  );
  if (matches.length > 0) return matches.slice(0, 3).map((match) => clamp(match, 90));
  if (entry.entryType === "follow_up" || entry.entryType === "action") {
    return [clamp(text, 90)];
  }
  return [];
}

function FollowUpActionPanel({ entry }: { entry: DiaryEntryView }) {
  const suggestions = useMemo(() => suggestedFollowUps(entry), [entry]);
  const [title, setTitle] = useState(suggestions[0] ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function createAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setMessage(null);
    startTransition(async () => {
      const result = await createDiaryFollowUpAction(formData);
      setMessage(
        result.ok
          ? "Action created. It now appears under Actions."
          : result.error ?? "Could not create the action.",
      );
    });
  }

  return (
    <details className="diary-followup">
      <summary>Create a Follow-up</summary>
      <form onSubmit={createAction} className="diary-followup__form">
        <input type="hidden" name="id" value={entry.id} />
        {suggestions.length > 0 ? (
          <div className="diary-followup__suggestions">
            <span className="field__label">Suggested from this entry</span>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="diary-prompt"
                onClick={() => setTitle(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
        <label className="field">
          <span className="field__label">Action title</span>
          <input
            className="input"
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Confirm next steps with finance…"
            autoComplete="off"
            required
          />
        </label>
        <button type="submit" className="btn btn--secondary" disabled={pending}>
          {pending ? "Creating…" : "Create Action"}
        </button>
      </form>
      {message ? (
        <p className="form-message" aria-live="polite">
          {message}
        </p>
      ) : null}
    </details>
  );
}

function RiskControls({ entry }: { entry: DiaryEntryView }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const active = entry.entryType === "risk" && entry.riskStatus !== "resolved";
  if (entry.entryType !== "risk") return null;

  function resolveRisk() {
    if (!window.confirm("Mark this risk as resolved?")) return;
    const formData = new FormData();
    formData.set("id", entry.id);
    startTransition(async () => {
      const result = await resolveRiskEntryAction(formData);
      setMessage(
        result.ok
          ? "Risk resolved. It will no longer appear as active in the briefing."
          : result.error ?? "Could not resolve this risk.",
      );
    });
  }

  return (
    <div className="diary-risk">
      <span className={`status status--${active ? "risk" : "ok"}`}>
        {active ? "Active Risk" : "Resolved Risk"}
      </span>
      {active ? (
        <button
          type="button"
          className="btn btn--ghost"
          onClick={resolveRisk}
          disabled={pending}
        >
          {pending ? "Resolving…" : "Mark Resolved"}
        </button>
      ) : null}
      {message ? (
        <p className="form-message" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
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
        {edited ? <span>· edited</span> : null}
        <TypeChip type={editing ? type : entry.entryType} />
        {entry.kind === "voice" ? <span className="status status--info">Voice</span> : null}
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
            defaultValue={displayText(entry)}
            className="textarea"
          />
          <div className="diary-entry__edit-row">
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
          </div>
          {error ? (
            <p className="form-message form-message--error" aria-live="polite">
              {error}
            </p>
          ) : null}
          <div className="diary-entry__controls">
            <button type="submit" className="btn btn--primary" disabled={pending}>
              {pending ? "Saving…" : "Save Changes"}
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
          <p className="diary-entry__body">{displayText(entry)}</p>
          {entry.kind === "voice" ? (
            <p className="diary-helper">
              Original audio saved privately
              {entry.audioDurationSeconds ? ` · ${entry.audioDurationSeconds}s` : ""}.
            </p>
          ) : null}
          <RiskControls entry={entry} />
          <FollowUpActionPanel entry={entry} />
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
                if (!window.confirm("Delete this entry? This cannot be undone.")) {
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

  const isClient = useIsClient();
  const now = useMemo(() => (isClient ? new Date().getTime() : null), [isClient]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter !== "all" && entry.entryType !== filter) return false;
      if (q && !displayText(entry).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, filter, query]);

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
        <div>
          <p className="eyebrow">Daily record</p>
          <p className="diary-helper">
            Browse the underlying notes when you need detail. The weekly summary
            keeps the main surface clean.
          </p>
        </div>
        {hasEntries ? (
          <label className="field">
            <span className="field__label">Search</span>
            <input
              type="search"
              className="input diary-search"
              placeholder="Search entries…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
          </label>
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
        <div className="empty diary-empty">
          <p className="empty__title">Start the private record</p>
          <p className="empty__body">
            Use the diary to capture what happened, what you decided, what needs
            attention, and what should be remembered. One useful line is enough.
          </p>
          <p className="empty__body diary-empty__next">
            Pick a prompt above, record a voice note, or write the first entry.
          </p>
        </div>
      ) : groups.length === 0 ? (
        <div className="empty diary-empty">
          <p className="empty__title">No entries match</p>
          <p className="empty__body">
            Clear the search or filter to return to the full daily record.
          </p>
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

      {filtering ? <p className="diary-helper">{filtered.length} matching entries.</p> : null}
    </div>
  );
}
