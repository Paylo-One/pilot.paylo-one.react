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
import type {
  FeedbackType,
  UserFeedbackEvent,
} from "@/modules/refinement/refinement.types";
import { feedbackPresentation } from "@/modules/refinement/feedback-presentation";

export function FeedbackChip({
  feedback,
  targetType,
  targetId,
  label,
  initiallySaved = false,
  unavailable = false,
}: {
  feedback: FeedbackType;
  targetType: UserFeedbackEvent["targetType"];
  targetId: string;
  label?: string;
  initiallySaved?: boolean;
  unavailable?: boolean;
}) {
  const [applied, setApplied] = useState(initiallySaved);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const eventId = useRef<string | null>(null);
  const presentation = feedbackPresentation({
    feedback,
    targetType,
    label,
    unavailable,
    applied,
    pending,
  });

  return (
    <span>
      <button
        type="button"
        className={`feedback-chip${applied ? " feedback-chip--applied" : ""}`}
        aria-pressed={applied}
        title={presentation.title}
        data-target-id={targetId}
        disabled={presentation.disabled}
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
        {presentation.text}
      </button>
      {error ? (
        <span className="form-message form-message--error" role="status">
          {error}
        </span>
      ) : null}
    </span>
  );
}
