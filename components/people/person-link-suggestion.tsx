"use client";

/**
 * components/people/person-link-suggestion.tsx
 *
 * An "Is this the same person?" prompt — an unresolved incoming signal the
 * system could not confidently attribute. The operator confirms, rejects, or
 * creates a new person. The system proposes; it never silently merges
 * (architecture/people-context-architecture.md §6, §15).
 *
 * Scaffold: decisions update local state only (no persistence).
 */

import { useState } from "react";
import { SOURCE_SYSTEM_LABELS } from "@/modules/source-connection";
import type { PersonLinkSuggestion } from "@/modules/people/people.types";

type Decision = "pending" | "confirmed" | "rejected" | "new";

export function PersonLinkSuggestionCard({ suggestion }: { suggestion: PersonLinkSuggestion }) {
  const [decision, setDecision] = useState<Decision>("pending");

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
      </div>

      <div className="link-suggestion__controls">
        {decision === "pending" ? (
          <>
            {suggestion.candidatePersonId ? (
              <button type="button" className="btn btn--accent-outline btn--sm" onClick={() => setDecision("confirmed")}>
                Same person
              </button>
            ) : null}
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDecision("new")}>
              New person
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDecision("rejected")}>
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
