export interface DiaryFormState {
  readonly ok: boolean;
  readonly error: string | null;
}

export const initialDiaryFormState: DiaryFormState = { ok: false, error: null };
