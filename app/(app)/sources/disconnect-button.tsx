"use client";

import { useActionState } from "react";
import { disconnectConnectionAction } from "./actions";

export function DisconnectButton({ connectionId }: { connectionId: string }) {
  const [state, action, pending] = useActionState(disconnectConnectionAction, null);

  return (
    <form action={action} style={{ display: "inline" }}>
      <input type="hidden" name="connectionId" value={connectionId} />
      <button
        type="submit"
        disabled={pending}
        style={{
          padding: "2px 10px",
          fontSize: "var(--text-label)",
          fontWeight: 500,
          background: "transparent",
          color: "var(--colour-text-secondary)",
          border: "1px solid var(--colour-border-strong)",
          borderRadius: "var(--radius-sm)",
          cursor: "pointer",
          opacity: pending ? 0.5 : 1,
        }}
      >
        {pending ? "Disconnecting…" : "Disconnect"}
      </button>
      {state?.error ? (
        <span style={{ marginLeft: "var(--space-xs)", fontSize: "var(--text-label)", color: "var(--colour-danger, #9e3c34)" }}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
