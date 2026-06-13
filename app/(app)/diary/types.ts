/**
 * Client-safe shapes for the Diary surface.
 *
 * The canonical entry-type vocabulary also lives (server-side) in
 * `@/modules/diary`; it cannot be imported here because that module is
 * server-only. Both mirror the entry_type CHECK in
 * supabase/migrations/20260613170000_diary_entry_type.sql (ADR-041) — keep the
 * three in sync.
 */

export interface DiaryFormState {
  readonly ok: boolean;
  readonly error: string | null;
}

export const initialDiaryFormState: DiaryFormState = { ok: false, error: null };

/** The fixed, lightweight entry-type vocabulary. Defaults to "note". */
export const DIARY_ENTRY_TYPES = [
  "note",
  "decision",
  "action",
  "reflection",
  "meeting",
  "idea",
  "risk",
  "follow_up",
] as const;

export type DiaryEntryType = (typeof DIARY_ENTRY_TYPES)[number];

export const DEFAULT_DIARY_ENTRY_TYPE: DiaryEntryType = "note";

/** Muted status tone (never the teal accent) used for each type's chip. */
type DiaryTypeTone = "info" | "ok" | "warn" | "risk" | "neutral";

/** Plain Title-Case label + chip tone for each entry type. */
export const DIARY_TYPE_META: Record<
  DiaryEntryType,
  { label: string; tone: DiaryTypeTone }
> = {
  note: { label: "Note", tone: "neutral" },
  decision: { label: "Decision", tone: "info" },
  action: { label: "Action", tone: "ok" },
  reflection: { label: "Reflection", tone: "neutral" },
  meeting: { label: "Meeting", tone: "info" },
  idea: { label: "Idea", tone: "ok" },
  risk: { label: "Risk", tone: "risk" },
  follow_up: { label: "Follow-up", tone: "warn" },
};
