"use client";

/**
 * components/people/person-link-suggestion.tsx
 *
 * An "Is this the same person?" prompt — an ingested signal the correlation
 * pipeline could not confidently attribute. The operator confirms (→ a verified
 * identity is locked onto the candidate), rejects, or creates a new person. The
 * system proposes; it never silently merges (ADR-034). Decisions persist + are
 * audited (correlation_feedback).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SOURCE_SYSTEM_LABELS } from "@/modules/source-connection";
import type { PersonLinkSuggestion } from "@/modules/people/people.types";
import {
  confirmSuggestionAction,
  rejectSuggestionAction,
  newPersonFromSuggestionAction,
} from "@/app/(app)/people/actions";

type Decision = "pending" | "confirmed" | "rejected" | "new";

export function PersonLinkSuggestionCard({ suggestion }: { suggestion: PersonLinkSuggestion }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [decision, setDecision] = useState<Decision>("pending");
  const [error, setError] = useState<string | null>(null);

  function act(
    optimistic: Decision,
    action: () => Promise<{ ok: boolean; error: string | null }>,
  ) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        setDecision(optimistic);
        router.refresh();
      } else {
        setError(res.error ?? "Failed.");
      }
    });
  }

  return (
    <article className="link-suggestion">
      <div className="link-suggestion__main">
        <p className="memo-item__title">{suggestion.signalPreview}</p>
        <p className="repo-row__meta mono">
          {SOURCE_SYSTEM_LABELS[suggestion.sourceSystem] ?? suggestion.sourceSystem} ·{" "}
          {suggestion.observedIdentity} · {Math.round(suggestion.confidence * 100)}% confidence
        </p>
        <p className="action-card__rationale" style={{ marginTop: "var(--space-xs)" }}>
          {suggestion.candidateName
            ? `Likely: ${suggestion.candidateName}. ${suggestion.reason}`
            : suggestion.reason}
        </p>
        {error ? (
          <p className="form-message form-message--error">{error}</p>
        ) : null}
      </div>

      <div className="link-suggestion__controls">
        {decision === "pending" ? (
          <>
            {suggestion.candidatePersonId ? (
              <button type="button" className="btn btn--accent-outline btn--sm" disabled={pending}
                onClick={() => act("confirmed", () => confirmSuggestionAction({ suggestionId: suggestion.id }))}>
                Same person
              </button>
            ) : null}
            <button type="button" className="btn btn--ghost btn--sm" disabled={pending}
              onClick={() => act("new", () => newPersonFromSuggestionAction({ suggestionId: suggestion.id }))}>
              New person
            </button>
            <button type="button" className="btn btn--ghost btn--sm" disabled={pending}
              onClick={() => act("rejected", () => rejectSuggestionAction({ suggestionId: suggestion.id }))}>
              Not a match
            </button>
          </>
        ) : (
          <span className={`status status--${decision === "rejected" ? "neutral" : "ok"}`}>
            {decision === "confirmed" ? "Linked" : decision === "new" ? "New person" : "Dismissed"}
          </span>
        )}
      </div>
    </article>
  );
}
