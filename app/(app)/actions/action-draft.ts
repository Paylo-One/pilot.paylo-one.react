export const ACTION_DRAFT_STORAGE_KEY = "paylo:memo-action-draft";
const MAX_DRAFT_TITLE = 200;
const MAX_DRAFT_NOTE = 1_000;

export interface ActionDraft {
  readonly title: string;
  readonly note: string;
}

function bounded(input: Partial<ActionDraft>): ActionDraft {
  return {
    title: typeof input.title === "string" ? input.title.trim().slice(0, MAX_DRAFT_TITLE) : "",
    note: typeof input.note === "string" ? input.note.trim().slice(0, MAX_DRAFT_NOTE) : "",
  };
}

export function storeActionDraft(storage: Storage, input: ActionDraft): void {
  storage.setItem(ACTION_DRAFT_STORAGE_KEY, JSON.stringify(bounded(input)));
}

/** Read once so refresh/back navigation cannot unexpectedly refill a cleared form. */
export function consumeActionDraft(storage: Storage): ActionDraft | null {
  const serialized = storage.getItem(ACTION_DRAFT_STORAGE_KEY);
  storage.removeItem(ACTION_DRAFT_STORAGE_KEY);
  if (!serialized) return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object") return null;
    const draft = bounded(parsed as Partial<ActionDraft>);
    return draft.title ? draft : null;
  } catch {
    return null;
  }
}
