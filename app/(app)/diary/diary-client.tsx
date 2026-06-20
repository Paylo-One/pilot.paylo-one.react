"use client";

/**
 * Client interactivity for the Private Diary surface.
 *
 * The diary is one continuous record, not a form. A single capture surface lets
 * the author write or speak a thought — speech is transcribed straight into the
 * same editor — choose its kind, and keep it. Saved entries read back as a
 * calm, day-grouped thread. Everything here is private to the author (RLS +
 * author-scoped); nothing is fed to an agent this pass.
 */

import {
  useCallback,
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

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** A small, time-aware prompt: its label is both the chip and the placeholder. */
interface Prompt {
  label: string;
  type: DiaryEntryType;
}

type Period = "default" | "morning" | "afternoon" | "evening";

const GREETING: Record<Period, string> = {
  default: "Capture what matters",
  morning: "Start the day with a clear head",
  afternoon: "Note what has moved since this morning",
  evening: "Close the day before it blurs",
};

const PROMPTS: Record<Period, Prompt[]> = {
  default: [
    { label: "What should be remembered?", type: "note" },
    { label: "What did you decide?", type: "decision" },
    { label: "What needs attention next?", type: "follow_up" },
  ],
  morning: [
    { label: "What matters most today?", type: "note" },
    { label: "What needs a decision?", type: "decision" },
    { label: "What risk are you watching?", type: "risk" },
  ],
  afternoon: [
    { label: "What changed since this morning?", type: "note" },
    { label: "What did you decide?", type: "decision" },
    { label: "What needs following up?", type: "follow_up" },
  ],
  evening: [
    { label: "What happened today?", type: "reflection" },
    { label: "What can't be forgotten?", type: "note" },
    { label: "What still feels unresolved?", type: "risk" },
  ],
};

function periodFor(hour: number): Period {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** Light, on-device read of the text — a hint the author can take or ignore. */
function suggestType(text: string): DiaryEntryType | null {
  const t = text.toLowerCase();
  if (t.trim().length < 12) return null;
  if (/\b(decided|decision|chose|agreed|going with|settled on|will go)\b/.test(t)) return "decision";
  if (/\b(risk|worried|concern|exposure|blocker|might fail|could go wrong)\b/.test(t)) return "risk";
  if (/\b(follow[- ]?up|chase|check in|circle back|remind me|get back to)\b/.test(t)) return "follow_up";
  if (/\b(idea|what if|could we|maybe we should|worth trying)\b/.test(t)) return "idea";
  if (/\b(met with|spoke with|call with|meeting|sync|stand[- ]?up|1:1)\b/.test(t)) return "meeting";
  if (/\b(need to|must|to[- ]?do|action|send|draft|email|schedule)\b/.test(t)) return "action";
  if (/\b(learned|realised|realized|grateful|reflecting|in hindsight)\b/.test(t)) return "reflection";
  return null;
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

/* --- Icons ---------------------------------------------------------------- */

function MicIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
function ResumeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
function SparkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  );
}

function Waveform({ active }: { active: boolean }) {
  return (
    <span className={`diary-wave${active ? " diary-wave--active" : ""}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="diary-wave__bar" />
      ))}
    </span>
  );
}

function toAudioFile(blob: Blob): File {
  const type = blob.type || "audio/webm";
  const extension = type.includes("mp4") ? "m4a" : type.includes("wav") ? "wav" : "webm";
  return new File([blob], `diary-voice-note.${extension}`, { type });
}

type RecState = "idle" | "recording" | "paused";
type MicState = "ready" | "denied" | "unsupported";

/**
 * The single capture surface. Type, or speak and have it transcribed into the
 * same editor; choose a kind; keep it. One save path, one record, text or voice.
 */
export function DiaryCapture() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const previewUrlRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const baseSecondsRef = useRef(0);
  const resumedAtRef = useRef(0);

  const [text, setText] = useState("");
  const [type, setType] = useState<DiaryEntryType>(DEFAULT_DIARY_ENTRY_TYPE);
  const [typeTouched, setTypeTouched] = useState(false);
  const [placeholder, setPlaceholder] = useState<string | null>(null);

  const [recState, setRecState] = useState<RecState>("idle");
  const [micState, setMicState] = useState<MicState>("ready");
  const [elapsed, setElapsed] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startSaving] = useTransition();
  const [transcribing, startTranscribing] = useTransition();

  const isClient = useIsClient();
  const period = useMemo<Period>(
    () => (isClient ? periodFor(new Date().getHours()) : "default"),
    [isClient],
  );

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      stopTimer();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    },
    [stopTimer],
  );

  const suggestion = useMemo(() => suggestType(text), [text]);
  const showSuggestion = !typeTouched && suggestion !== null && suggestion !== type;

  function choosePrompt(prompt: Prompt) {
    setType(prompt.type);
    setTypeTouched(true);
    setPlaceholder(prompt.label);
    textareaRef.current?.focus();
  }

  function selectType(next: DiaryEntryType) {
    setType(next);
    setTypeTouched(true);
  }

  function offline(): boolean {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  }

  function tick() {
    setElapsed(baseSecondsRef.current + (Date.now() - resumedAtRef.current) / 1000);
  }

  function applyTranscript(transcript: string) {
    setText((prev) => {
      const base = prev.trim();
      return base ? `${base}\n\n${transcript}` : transcript;
    });
  }

  function runTranscription(blob: Blob) {
    if (offline()) {
      setError("You're offline. Reconnect to transcribe — or type the note and save it now.");
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.set("audio", toAudioFile(blob));
    startTranscribing(async () => {
      const result = await transcribeVoiceNoteAction(formData);
      if (result.ok && result.transcript) {
        applyTranscript(result.transcript);
        setNotice("Added to your entry. Edit it however you like before saving.");
        textareaRef.current?.focus();
      } else {
        setError(
          result.error ??
            "Couldn't turn that recording into words. The audio is kept — try again, or type the note.",
        );
      }
    });
  }

  async function startRecording() {
    setError(null);
    setNotice(null);
    setSaved(false);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMicState("unsupported");
      setError("This browser can't record audio. You can still type your entry.");
      return;
    }
    if (offline()) {
      setError("You're offline. You can still type an entry and save it once you reconnect.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicState("ready");
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        const nextUrl = URL.createObjectURL(blob);
        previewUrlRef.current = nextUrl;
        setAudioBlob(blob);
        setPreviewUrl(nextUrl);
        setDurationSeconds(baseSecondsRef.current);
        stream.getTracks().forEach((track) => track.stop());
        runTranscription(blob);
      };

      mediaRecorderRef.current = recorder;
      baseSecondsRef.current = 0;
      resumedAtRef.current = Date.now();
      setElapsed(0);
      setAudioBlob(null);
      setPreviewUrl(null);
      recorder.start();
      setRecState("recording");
      stopTimer();
      timerRef.current = window.setInterval(tick, 200);
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : "";
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        setMicState("unsupported");
        setError("No microphone was found. Plug one in, or type your entry instead.");
      } else {
        setMicState("denied");
        setError("Microphone access is off. Allow it in your browser, or type your entry instead.");
      }
    }
  }

  function pauseRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recState !== "recording") return;
    recorder.pause();
    baseSecondsRef.current += (Date.now() - resumedAtRef.current) / 1000;
    stopTimer();
    setElapsed(baseSecondsRef.current);
    setRecState("paused");
  }

  function resumeRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recState !== "paused") return;
    recorder.resume();
    resumedAtRef.current = Date.now();
    setRecState("recording");
    stopTimer();
    timerRef.current = window.setInterval(tick, 200);
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recState === "recording") {
      baseSecondsRef.current += (Date.now() - resumedAtRef.current) / 1000;
    }
    stopTimer();
    setElapsed(baseSecondsRef.current);
    recorder.stop();
    setRecState("idle");
  }

  function discardRecording() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setAudioBlob(null);
    setPreviewUrl(null);
    setDurationSeconds(0);
    setElapsed(0);
    setNotice(null);
  }

  function resetAfterSave() {
    setText("");
    setType(DEFAULT_DIARY_ENTRY_TYPE);
    setTypeTouched(false);
    setPlaceholder(null);
    discardRecording();
    setError(null);
  }

  function save() {
    const body = text.trim();
    if (!body) {
      setError(
        audioBlob
          ? "Add a line of text — transcribe the recording or jot the gist — before saving."
          : "Write a line, or record a thought, before saving.",
      );
      textareaRef.current?.focus();
      return;
    }
    if (offline()) {
      setError("You're offline. Your words are safe here — save again once you reconnect.");
      return;
    }
    setError(null);
    setNotice(null);

    startSaving(async () => {
      if (audioBlob) {
        const formData = new FormData();
        formData.set("audio", toAudioFile(audioBlob));
        formData.set("transcript", body);
        formData.set("body", body);
        formData.set("entryType", type);
        formData.set("durationSeconds", String(Math.round(durationSeconds)));
        const result = await createVoiceEntryAction(initialDiaryFormState, formData);
        if (result.ok) {
          resetAfterSave();
          setSaved(true);
        } else {
          setError(result.error ?? "Couldn't save this entry. Try again in a moment.");
        }
        return;
      }

      const formData = new FormData();
      formData.set("body", body);
      formData.set("entryType", type);
      const result = await createEntryAction(initialDiaryFormState, formData);
      if (result.ok) {
        resetAfterSave();
        setSaved(true);
      } else {
        setError(result.error ?? "Couldn't save this entry. Try again in a moment.");
      }
    });
  }

  const recording = recState !== "idle";
  const busy = pending || transcribing;

  return (
    <section className="diary-capture" aria-label="Write a diary entry">
      <div className="diary-capture__head">
        <div>
          <p className="diary-capture__greeting">{GREETING[period]}.</p>
          <p className="diary-capture__hint">
            Write it, speak it, or turn it into an action. One honest line is enough.
          </p>
        </div>
        <span className="diary-lock" title="Only you can read your diary">
          <LockIcon />
          Private
        </span>
      </div>

      <div className="diary-prompts" role="group" aria-label="Prompts to get started">
        {PROMPTS[period].map((prompt) => (
          <button
            key={prompt.label}
            type="button"
            className={`diary-prompt${placeholder === prompt.label ? " diary-prompt--active" : ""}`}
            onClick={() => choosePrompt(prompt)}
          >
            {prompt.label}
          </button>
        ))}
      </div>

      <div className={`diary-editor${recording ? " diary-editor--recording" : ""}`}>
        <label className="sr-only" htmlFor="diary-body">
          Your diary entry
        </label>
        <textarea
          id="diary-body"
          ref={textareaRef}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (saved) setSaved(false);
          }}
          rows={5}
          placeholder={placeholder ?? "Write freely, or tap the mic to speak it…"}
          className="diary-editor__input"
          autoComplete="off"
          disabled={transcribing}
        />
        {transcribing ? (
          <div className="diary-editor__overlay" aria-hidden="true">
            <Waveform active />
            <span>Turning your words into text…</span>
          </div>
        ) : null}
      </div>

      {showSuggestion ? (
        <button
          type="button"
          className="diary-suggest"
          onClick={() => selectType(suggestion)}
        >
          <SparkIcon />
          This reads like a <strong>{DIARY_TYPE_META[suggestion].label}</strong>. Use it?
        </button>
      ) : null}

      <div className="diary-capture__toolbar">
        <div className="diary-capture__voice">
          {recState === "idle" && !audioBlob ? (
            <button type="button" className="btn btn--secondary" onClick={startRecording} disabled={busy}>
              <MicIcon />
              Record a voice note
            </button>
          ) : null}

          {recording ? (
            <div className="diary-rec" role="status" aria-live="polite">
              <span className={`diary-rec__dot${recState === "paused" ? " diary-rec__dot--paused" : ""}`} />
              <span className="diary-rec__time">{formatDuration(elapsed)}</span>
              <Waveform active={recState === "recording"} />
              {recState === "recording" ? (
                <button type="button" className="btn btn--ghost btn--sm" onClick={pauseRecording} aria-label="Pause recording">
                  <PauseIcon />
                  Pause
                </button>
              ) : (
                <button type="button" className="btn btn--ghost btn--sm" onClick={resumeRecording} aria-label="Resume recording">
                  <ResumeIcon />
                  Resume
                </button>
              )}
              <button type="button" className="btn btn--primary btn--sm" onClick={stopRecording}>
                <StopIcon />
                Stop
              </button>
            </div>
          ) : null}

          {!recording && audioBlob ? (
            <div className="diary-clip">
              {previewUrl ? <audio className="diary-clip__audio" src={previewUrl} controls /> : null}
              <span className="diary-clip__meta">{formatDuration(durationSeconds)}</span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => audioBlob && runTranscription(audioBlob)}
                disabled={busy}
              >
                {transcribing ? "Transcribing…" : "Transcribe again"}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={discardRecording} disabled={busy}>
                Remove
              </button>
            </div>
          ) : null}
        </div>

        <div className="diary-capture__commit">
          <label className="diary-type-field">
            <span className="field__label">Kind</span>
            <select
              className="input diary-type-select"
              value={type}
              onChange={(event) => selectType(event.target.value as DiaryEntryType)}
              disabled={busy}
            >
              {DIARY_ENTRY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {DIARY_TYPE_META[value].label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn--primary" onClick={save} disabled={busy}>
            {pending ? "Saving…" : "Save to diary"}
          </button>
        </div>
      </div>

      {micState === "denied" ? (
        <p className="diary-capture__status diary-capture__status--error" aria-live="polite">
          Microphone access is off. Turn it on in your browser settings to record — or just keep typing.
        </p>
      ) : null}
      {error ? (
        <p className="diary-capture__status diary-capture__status--error" aria-live="polite">
          {error}
        </p>
      ) : null}
      {notice && !error ? (
        <p className="diary-capture__status" aria-live="polite">
          {notice}
        </p>
      ) : null}
      {saved && !error && !notice ? (
        <p className="diary-capture__status diary-capture__status--ok" aria-live="polite">
          Kept. It&rsquo;s in your record below.
        </p>
      ) : null}
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
        <p>Nothing stood out.</p>
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
          ? "Your week is gathered below."
          : result.error ?? "Couldn't gather the week just now. Try again in a moment.",
      );
    });
  }

  return (
    <section className="diary-summary">
      <div className="diary-summary__head">
        <div>
          <p className="eyebrow">The week, gathered</p>
          <h2>Everything that mattered, in one place</h2>
          <p>
            A calm recap of the week&rsquo;s reflections, decisions, risks, and
            follow-ups — so the daily record stays a record, not another feed.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={generateSummary}
          disabled={pending || entryCount === 0}
        >
          {pending ? "Gathering…" : latest ? "Refresh the week" : "Gather the week"}
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
            <SummaryList title="Reflections" items={latest.keyReflections} />
            <SummaryList title="Decisions" items={latest.importantDecisions} />
            <SummaryList title="Risks" items={latest.notableRisks} />
            <SummaryList title="Follow-ups" items={latest.followUpsCreated} />
            <SummaryList title="Recurring themes" items={latest.recurringThemes} />
            <SummaryList title="Next week" items={latest.nextWeekAttention} />
          </div>
        </>
      ) : (
        <p className="diary-empty-note">
          Nothing to gather yet. Keep a few entries through the week, then gather
          them here when there&rsquo;s enough to look back on.
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
          ? "Done — it's waiting for you in Actions."
          : result.error ?? "Couldn't create the action. Try again in a moment.",
      );
    });
  }

  return (
    <details className="diary-followup">
      <summary>Turn this into an action</summary>
      <form onSubmit={createAction} className="diary-followup__form">
        <input type="hidden" name="id" value={entry.id} />
        {suggestions.length > 0 ? (
          <div className="diary-followup__suggestions">
            <span className="field__label">From this entry</span>
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
          <span className="field__label">What needs doing</span>
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
        <button type="submit" className="btn btn--secondary btn--sm" disabled={pending}>
          {pending ? "Creating…" : "Create action"}
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
          ? "Resolved. It will drop out of your briefing."
          : result.error ?? "Couldn't resolve this risk. Try again in a moment.",
      );
    });
  }

  if (!active) {
    return (
      <div className="diary-risk">
        <span className="status status--ok">Resolved</span>
      </div>
    );
  }

  return (
    <div className="diary-risk">
      <span className="status status--risk">Watching</span>
      <button type="button" className="btn btn--ghost btn--sm" onClick={resolveRisk} disabled={pending}>
        {pending ? "Resolving…" : "Mark resolved"}
      </button>
      {message ? (
        <p className="form-message" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** A single entry in the thread: read view with quiet tools, or an edit form. */
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
        setError(result.error ?? "Couldn't save your changes.");
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
      <div className="diary-entry__rail" aria-hidden="true">
        <span className={`diary-entry__node diary-entry__node--${DIARY_TYPE_META[entry.entryType].tone}`} />
      </div>
      <div className="diary-entry__main">
        <div className="diary-entry__meta">
          <time>{created ? timeFormat.format(created) : entry.createdAt}</time>
          <TypeChip type={editing ? type : entry.entryType} />
          {entry.kind === "voice" ? (
            <span className="diary-entry__voice">
              <MicIcon />
              Voice
            </span>
          ) : null}
          {edited ? <span className="diary-entry__edited">edited</span> : null}
        </div>

        {editing ? (
          <form onSubmit={handleEditSubmit} className="diary-entry__form">
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
                <span className="field__label">Kind</span>
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
              <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>
                {pending ? "Saving…" : "Save changes"}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={cancelEdit} disabled={pending}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="diary-entry__body">{displayText(entry)}</p>
            {entry.kind === "voice" && entry.audioDurationSeconds ? (
              <p className="diary-entry__note">
                Audio kept privately · {formatDuration(entry.audioDurationSeconds)}
              </p>
            ) : null}
            <RiskControls entry={entry} />
            <FollowUpActionPanel entry={entry} />
            <div className="diary-entry__controls diary-entry__controls--quiet">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(true)}>
                Edit
              </button>
              <form
                action={deleteEntryAction}
                onSubmit={(event) => {
                  if (!window.confirm("Delete this entry? This can't be undone.")) {
                    event.preventDefault();
                  }
                }}
              >
                <input type="hidden" name="id" value={entry.id} />
                <button type="submit" className="btn btn--ghost btn--sm">
                  Delete
                </button>
              </form>
            </div>
          </>
        )}
      </div>
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
  const diffDays = Math.round((startOf(now) - startOf(date.getTime())) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return dayFormat.format(date);
}

/** Filter + search + day-grouped thread of the author's entries. */
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
          <p className="eyebrow">Your record</p>
          <h2 className="diary-timeline__title">Everything you&rsquo;ve kept</h2>
        </div>
        {hasEntries ? (
          <label className="field diary-search-field">
            <span className="sr-only">Search your diary</span>
            <input
              type="search"
              className="input diary-search"
              placeholder="Search your entries…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
          </label>
        ) : null}
      </div>

      {hasEntries ? (
        <div className="segmented diary-filter" role="group" aria-label="Filter by kind">
          <button
            type="button"
            className={`segmented__option${filter === "all" ? " segmented__option--active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          {DIARY_ENTRY_TYPES.map((value) => (
            <button
              key={value}
              type="button"
              className={`segmented__option${filter === value ? " segmented__option--active" : ""}`}
              onClick={() => setFilter(value)}
            >
              {DIARY_TYPE_META[value].label}
            </button>
          ))}
        </div>
      ) : null}

      {!hasEntries ? (
        <div className="diary-empty">
          <span className="diary-empty__mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </span>
          <p className="diary-empty__title">Your diary starts with one line</p>
          <p className="diary-empty__body">
            Keep what happened, what you decided, what you&rsquo;re watching, and
            what shouldn&rsquo;t slip. Pick a prompt above, speak it, or just start
            writing — it stays private to you.
          </p>
        </div>
      ) : groups.length === 0 ? (
        <div className="diary-empty">
          <p className="diary-empty__title">Nothing matches that</p>
          <p className="diary-empty__body">
            Clear the search or filter to see your full record again.
          </p>
        </div>
      ) : (
        <div className="diary-days">
          {groups.map((group) => (
            <section key={group.key} className="diary-day">
              <p className="diary-day__label">{group.label}</p>
              <ul className="diary-thread">
                {group.items.map((entry) => (
                  <DiaryEntryItem key={entry.id} entry={entry} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {filtering && groups.length > 0 ? (
        <p className="diary-timeline__count">
          {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
        </p>
      ) : null}
    </div>
  );
}
