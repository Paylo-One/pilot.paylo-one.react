export const ACTION_DRAFT_STORAGE_KEY = "paylo:memo-action-draft";
const MAX_DRAFT_TITLE = 200;
const MAX_DRAFT_NOTE = 1_000;
const MAX_DRAFT_AGE_MS = 15 * 60 * 1_000;

export interface ActionDraft {
  readonly title: string;
  readonly note: string;
  readonly contextId: string;
  readonly createdFrom: "briefing";
  readonly createdAt: number;
}

export type ActionDraftInput = Omit<ActionDraft, "createdAt">;

function bounded(input: Partial<ActionDraft>, createdAt: number): ActionDraft {
  return {
    title: typeof input.title === "string" ? input.title.trim().slice(0, MAX_DRAFT_TITLE) : "",
    note: typeof input.note === "string" ? input.note.trim().slice(0, MAX_DRAFT_NOTE) : "",
    contextId: typeof input.contextId === "string" ? input.contextId : "",
    createdFrom: "briefing",
    createdAt: typeof input.createdAt === "number" ? input.createdAt : createdAt,
  };
}

export function storeActionDraft(storage: Storage, input: ActionDraftInput, now = Date.now()): void {
  storage.setItem(ACTION_DRAFT_STORAGE_KEY, JSON.stringify(bounded(input, now)));
}

/** Read once so refresh/back navigation cannot unexpectedly refill a cleared form. */
export function consumeActionDraft(storage: Storage, contextId: string, now = Date.now()): ActionDraft | null {
  let serialized: string | null;
  try {
    serialized = storage.getItem(ACTION_DRAFT_STORAGE_KEY);
    storage.removeItem(ACTION_DRAFT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!serialized) return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object") return null;
    const draft = bounded(parsed as Partial<ActionDraft>, 0);
    const age = now - draft.createdAt;
    return draft.title && draft.contextId === contextId && age >= 0 && age <= MAX_DRAFT_AGE_MS
      ? draft
      : null;
  } catch {
    return null;
  }
}
