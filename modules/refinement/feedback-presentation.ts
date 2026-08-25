import { FEEDBACK_LABELS, type FeedbackType } from "./refinement.types";

export function feedbackPresentation({
  feedback,
  targetType,
  label,
  unavailable,
  applied,
  pending,
}: {
  feedback: FeedbackType;
  targetType: string;
  label?: string;
  unavailable: boolean;
  applied: boolean;
  pending: boolean;
}) {
  if (unavailable) {
    return {
      disabled: true,
      title: "Saved feedback could not be checked. Refresh to try again.",
      text: "Feedback unavailable",
    };
  }

  const undoable = feedback === "not_relevant";
  return {
    disabled: pending || (applied && !undoable),
    title: applied && undoable ? "Undo saved feedback" : `${FEEDBACK_LABELS[feedback]} — ${targetType}`,
    text: pending
      ? applied && undoable ? "Undoing…" : "Saving…"
      : applied ? `✓ Feedback saved${undoable ? " · Undo" : ""}` : label ?? FEEDBACK_LABELS[feedback],
  };
}
