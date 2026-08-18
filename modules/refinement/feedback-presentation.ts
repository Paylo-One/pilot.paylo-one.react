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

  return {
    disabled: pending || applied,
    title: `${FEEDBACK_LABELS[feedback]} — ${targetType}`,
    text: applied ? "✓ Feedback saved" : pending ? "Saving…" : label ?? FEEDBACK_LABELS[feedback],
  };
}
