export type ActionOrigin = "manual" | "briefing";

/** Parse the untrusted server-action value into a supported persisted origin. */
export function actionOrigin(value: unknown): ActionOrigin {
  return value === "briefing" ? "briefing" : "manual";
}

const ACTION_ORIGIN_LABELS: Readonly<Record<string, string>> = {
  manual: "Manually captured",
  briefing: "Confirmed from Daily briefing",
  suggestion: "Suggested by Pilot",
  diary: "Created from diary",
  meeting: "Extracted from meeting",
  email: "Extracted from email",
  people: "Created from People",
};

/** Present persisted provenance without overstating automation or authorship. */
export function actionOriginLabel(value: unknown): string {
  return typeof value === "string" && ACTION_ORIGIN_LABELS[value]
    ? ACTION_ORIGIN_LABELS[value]
    : "Origin unavailable";
}
