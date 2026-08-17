"use client";

/**
 * components/refinement/feedback-chip.tsx
 *
 * A single one-tap refinement affordance. Captures explicit user feedback on a
 * target (a memo item, action, signal, person, chat). Acknowledgement follows
 * durable event capture; no standing rule or hidden model learning is applied.
 */

import { useRef, useState, useTransition } from "react";
import { submitFeedbackAction } from "@/modules/refinement/actions";
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
  initiallySaved = false,
}: {
  feedback: FeedbackType;
  targetType: UserFeedbackEvent["targetType"];
  targetId: string;
  label?: string;
  initiallySaved?: boolean;
}) {
  const [applied, setApplied] = useState(initiallySaved);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const eventId = useRef<string | null>(null);

  return (
    <span>
      <button
        type="button"
        className={`feedback-chip${applied ? " feedback-chip--applied" : ""}`}
        aria-pressed={applied}
        title={`${FEEDBACK_LABELS[feedback]} — ${targetType}`}
        data-target-id={targetId}
        disabled={pending || applied}
        onClick={() => {
          eventId.current ??= crypto.randomUUID();
          setError(null);
          startTransition(async () => {
            try {
              const result = await submitFeedbackAction({
                eventId: eventId.current,
                feedbackType: feedback,
                targetType,
                targetId,
              });
              if (result.ok) setApplied(true);
              else setError(result.error);
            } catch {
              setError("Pilot could not save that feedback. Please try again.");
            }
          });
        }}
      >
        {applied ? "✓ Feedback saved" : pending ? "Saving…" : label ?? FEEDBACK_LABELS[feedback]}
      </button>
      {error ? (
        <span className="form-message form-message--error" role="status">
          {error}
        </span>
      ) : null}
    </span>
  );
}
