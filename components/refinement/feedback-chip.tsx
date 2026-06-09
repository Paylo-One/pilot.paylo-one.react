"use client";

/**
 * components/refinement/feedback-chip.tsx
 *
 * A single one-tap refinement affordance. Captures explicit user feedback on a
 * target (a memo item, action, signal, person, chat). Scaffold: clicking emits
 * a local, non-persisted event and shows an acknowledgement — no learning logic,
 * no model fine-tuning (architecture/information-refinement-loop.md §12).
 */

import { useState } from "react";
import {
  FEEDBACK_LABELS,
  type FeedbackType,
  type UserFeedbackEvent,
} from "@/modules/refinement/refinement.types";

export function FeedbackChip({
  feedback,
  targetType,
  targetId,
  label,
}: {
  feedback: FeedbackType;
  targetType: UserFeedbackEvent["targetType"];
  targetId: string;
  label?: string;
}) {
  const [applied, setApplied] = useState(false);

  return (
    <button
      type="button"
      className={`feedback-chip${applied ? " feedback-chip--applied" : ""}`}
      aria-pressed={applied}
      title={`${FEEDBACK_LABELS[feedback]} — ${targetType}`}
      data-target-id={targetId}
      onClick={() => setApplied((v) => !v)}
    >
      {applied ? "✓ " : ""}
      {label ?? FEEDBACK_LABELS[feedback]}
    </button>
  );
}
