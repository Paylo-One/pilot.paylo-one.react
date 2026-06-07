"use client";

/**
 * Client controls for an operator decision on a suggested action. The
 * approve/defer/dismiss buttons call the `decideAction` server action inside a
 * transition; resolved actions show their status instead of controls. No
 * external action is ever taken — only the status changes.
 */

import { useState, useTransition } from "react";
import { decideAction, type ActionDecision } from "./actions";

const RESOLVED_LABEL: Record<string, string> = {
  approved: "Approved",
  deferred: "Deferred",
  dismissed: "Dismissed",
  edited: "Edited",
};

const buttonStyle: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "var(--text-small)",
  padding: "var(--space-xs) var(--space-md)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--colour-border-strong)",
  background: "var(--colour-surface-elevated)",
  color: "var(--colour-text-primary)",
  cursor: "pointer",
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
    return (
      <span className="badge" style={{ textTransform: "none" }}>
        {RESOLVED_LABEL[status] ?? status}
      </span>
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
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: "var(--space-xs)" }}>
        <button
          type="button"
          onClick={() => decide("approve")}
          disabled={isPending}
          style={{
            ...buttonStyle,
            border: "1px solid var(--colour-accent)",
            color: "var(--colour-accent)",
          }}
        >
          Approve
        </button>
        <button type="button" onClick={() => decide("defer")} disabled={isPending} style={buttonStyle}>
          Defer
        </button>
        <button type="button" onClick={() => decide("dismiss")} disabled={isPending} style={buttonStyle}>
          Dismiss
        </button>
      </div>
      {error ? (
        <p style={{ color: "#b4452f", fontSize: "var(--text-small)" }} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
