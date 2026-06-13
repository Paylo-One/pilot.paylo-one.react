"use client";

import { useState, useTransition } from "react";
import { submitNewsFeedbackAction } from "@/app/(app)/sources/news-actions";
import {
  NEWS_FEEDBACK_LABELS,
  type NewsFeedbackSignal,
} from "@/modules/news";

const SIGNALS: readonly NewsFeedbackSignal[] = [
  "more_like_this",
  "less_like_this",
  "important",
  "not_relevant",
  "hide_source",
];

export function NewsFeedbackBar({
  newsItemId,
  sourceName,
  topic,
}: {
  newsItemId: string;
  sourceName: string;
  topic?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [applied, setApplied] = useState<NewsFeedbackSignal | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="refinement-actions" aria-label={`Feedback for ${sourceName}`}>
      <span className="refinement-actions__label mono">Tune</span>
      {SIGNALS.map((signal) => (
        <button
          key={signal}
          type="button"
          className={`feedback-chip${applied === signal ? " feedback-chip--applied" : ""}`}
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await submitNewsFeedbackAction({
                newsItemId,
                signal,
                topic,
              });
              if (result.ok) setApplied(signal);
              else setError(result.error);
            });
          }}
        >
          {NEWS_FEEDBACK_LABELS[signal]}
        </button>
      ))}
      {error ? <span className="form-message form-message--error">{error}</span> : null}
    </div>
  );
}
