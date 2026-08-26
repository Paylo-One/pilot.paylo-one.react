export type ActionOrigin = "manual" | "briefing";

/** Parse the untrusted server-action value into a supported persisted origin. */
export function actionOrigin(value: unknown): ActionOrigin {
  return value === "briefing" ? "briefing" : "manual";
}
