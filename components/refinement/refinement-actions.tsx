"use client";

/**
 * components/refinement/refinement-actions.tsx
 *
 * A row of refinement affordances attached to a piece of information (a memo
 * item, suggested action, or signal). This is where the operator corrects and
 * guides the system: "Not relevant", "Always include", "Wrong person", "Lower
 * priority", "Treat as action", "Link to project/topic"…
 *
 * Scaffold: emits local feedback only. The standing rules these would create
 * (architecture/information-refinement-loop.md) are not persisted yet.
 */

import type { FeedbackType, UserFeedbackEvent } from "@/modules/refinement/refinement.types";
import { FeedbackChip } from "./feedback-chip";

/** Sensible default affordances for a generic memo/action item. */
const DEFAULT_FEEDBACK: FeedbackType[] = [
  "not_relevant",
  "always_include",
  "lower_priority",
  "treat_as_action",
  "link_topic",
];

export function RefinementActions({
  targetType,
  targetId,
  feedback = DEFAULT_FEEDBACK,
}: {
  targetType: UserFeedbackEvent["targetType"];
  targetId: string;
  feedback?: FeedbackType[];
}) {
  return (
    <div className="refinement-actions" role="group" aria-label="Refine this">
      <span className="refinement-actions__label mono">Refine</span>
      {feedback.map((f) => (
        <FeedbackChip key={f} feedback={f} targetType={targetType} targetId={targetId} />
      ))}
    </div>
  );
}
