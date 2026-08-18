"use client";

/**
 * components/refinement/refinement-actions.tsx
 *
 * A row of one-off feedback affordances attached to a piece of information.
 * This lets the operator flag what was not useful without implying an
 * immediate or persistent change to Pilot's rules.
 *
 * This surface captures one-off feedback only. Standing-rule affordances stay
 * out of the UI until the product can apply and let operators inspect them.
 */

import type { FeedbackType, UserFeedbackEvent } from "@/modules/refinement/refinement.types";
import { FeedbackChip } from "./feedback-chip";

/** Honest default: this records a correction without promising a rule change. */
const DEFAULT_FEEDBACK: FeedbackType[] = ["not_relevant"];

export function RefinementActions({
  targetType,
  targetId,
  feedback = DEFAULT_FEEDBACK,
  savedFeedback = [],
  unavailable = false,
}: {
  targetType: UserFeedbackEvent["targetType"];
  targetId: string;
  feedback?: FeedbackType[];
  savedFeedback?: readonly FeedbackType[];
  unavailable?: boolean;
}) {
  return (
    <div className="refinement-actions" role="group" aria-label="Refine this">
      <span className="refinement-actions__label mono">Refine</span>
      {feedback.map((f) => (
        <FeedbackChip
          key={f}
          feedback={f}
          targetType={targetType}
          targetId={targetId}
          initiallySaved={savedFeedback.includes(f)}
          unavailable={unavailable}
        />
      ))}
    </div>
  );
}
