/**
 * Form state for the public Request access flow. Kept in a plain module (not the
 * "use server" actions file, whose every export must be an async action) so the
 * client form and the server action can share the shape.
 */

export interface RequestAccessState {
  /** idle before submit, ok on success, error when something needs fixing. */
  readonly status: "idle" | "ok" | "error";
  /** A plain-language message to show on error (null otherwise). */
  readonly message: string | null;
}

export const initialRequestAccessState: RequestAccessState = {
  status: "idle",
  message: null,
};
