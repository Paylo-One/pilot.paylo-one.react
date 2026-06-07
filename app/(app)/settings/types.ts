export interface ProfileFormState {
  readonly ok: boolean;
  readonly error: string | null;
}

export const initialProfileFormState: ProfileFormState = {
  ok: false,
  error: null,
};
