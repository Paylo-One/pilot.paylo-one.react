"use client";

/**
 * Client controls for an operator decision on a suggested action. The
 * governance model is approve / edit / dismiss / defer (product/actions.md):
 * approve, defer, and dismiss are wired to the `decideAction` server action
 * (status changes only — nothing is ever sent externally). Edit (adjust title /
 * notes / due before confirming) is part of the designed flow but not yet wired,
 * so it is presented as a clearly-disabled affordance.
 *
 * Resolved actions show their status instead of controls.
 */

import { useState, useTransition } from "react";
import { decideAction, type ActionDecision } from "./actions";

const RESOLVED: Record<string, { label: string; tone: string }> = {
  approved: { label: "Confirmed", tone: "ok" },
  edited: { label: "Edited", tone: "ok" },
  deferred: { label: "Deferred", tone: "info" },
  dismissed: { label: "Dismissed", tone: "neutral" },
};

export function ActionControls({
  actionId,
  status,
}: {
  actionId: string;
  status: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (status !== "suggested") {
    const resolved = RESOLVED[status] ?? { label: status, tone: "neutral" };
    return (
      <span className={`status status--${resolved.tone}`}>{resolved.label}</span>
    );
  }

  function decide(decision: ActionDecision) {
    setError(null);
    startTransition(async () => {
      const response = await decideAction(actionId, decision);
      if (!response.ok) {
        setError(response.error ?? "Could not update this action.");
      }
    });
  }

  return (
    <div className="action-controls-wrap">
      <div className="action-controls">
        <button
          type="button"
          onClick={() => decide("approve")}
          disabled={isPending}
          className="btn btn--accent-outline"
        >
          {isPending ? "Updating…" : "Confirm"}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled
          title="Edit before confirming is planned"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => decide("defer")}
          disabled={isPending}
          className="btn btn--ghost"
        >
          Defer
        </button>
        <button
          type="button"
          onClick={() => decide("dismiss")}
          disabled={isPending}
          className="btn btn--ghost"
        >
          Dismiss
        </button>
      </div>
      {error ? (
        <p
          className="form-message form-message--error"
          role="alert"
          aria-live="polite"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
