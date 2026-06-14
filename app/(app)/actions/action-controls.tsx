"use client";

/**
 * Client controls for actions, allowing quick state transitions
 * within the Action Command Centre.
 */

import { useState, useTransition } from "react";
import { updateAction, completeAction } from "./actions";
import { ActionStatus } from "@/modules/action-extraction/server";

export function ActionControls({
  actionId,
  status,
  onStatusChange,
}: {
  actionId: string;
  status: ActionStatus;
  onStatusChange?: (status: ActionStatus) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function transitionTo(nextStatus: ActionStatus) {
    setError(null);
    startTransition(async () => {
      let res;
      if (nextStatus === "completed") {
        res = await completeAction(actionId);
      } else {
        res = await updateAction(actionId, { status: nextStatus });
      }

      if (!res.ok) {
        setError(res.error ?? "Failed to update action status.");
      } else if (onStatusChange) {
        onStatusChange(nextStatus);
      }
    });
  }

  return (
    <div className="action-controls-wrap">
      <div className="action-controls" style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {status !== "completed" && (
          <button
            type="button"
            onClick={() => transitionTo("completed")}
            disabled={isPending}
            className="btn btn--accent-outline"
            style={{ fontSize: "12px", padding: "4px 8px" }}
          >
            ✓ Complete
          </button>
        )}
        
        {status !== "in_progress" && status !== "completed" && status !== "cancelled" && (
          <button
            type="button"
            onClick={() => transitionTo("in_progress")}
            disabled={isPending}
            className="btn btn--ghost"
            style={{ fontSize: "12px", padding: "4px 8px" }}
          >
            ⚡ Start
          </button>
        )}

        {status !== "waiting" && status !== "completed" && status !== "cancelled" && (
          <button
            type="button"
            onClick={() => transitionTo("waiting")}
            disabled={isPending}
            className="btn btn--ghost"
            style={{ fontSize: "12px", padding: "4px 8px" }}
          >
            ⏳ Wait
          </button>
        )}

        {status !== "cancelled" && status !== "completed" && (
          <button
            type="button"
            onClick={() => transitionTo("cancelled")}
            disabled={isPending}
            className="btn btn--ghost"
            style={{ fontSize: "12px", padding: "4px 8px", color: "var(--color-text-muted)" }}
          >
            Dismiss
          </button>
        )}
        
        {status === "completed" && (
          <span className="status status--ok">Completed</span>
        )}
        {status === "cancelled" && (
          <span className="status status--neutral">Cancelled</span>
        )}
      </div>
      {error ? (
        <p
          className="form-message form-message--error"
          role="alert"
          aria-live="polite"
          style={{ marginTop: "4px", fontSize: "11px" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
