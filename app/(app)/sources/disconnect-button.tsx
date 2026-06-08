"use client";

import { useActionState } from "react";
import { disconnectConnectionAction } from "./actions";

export function DisconnectButton({ connectionId }: { connectionId: string }) {
  const [state, action, pending] = useActionState(disconnectConnectionAction, null);

  return (
    <form action={action} style={{ display: "inline" }}>
      <input type="hidden" name="connectionId" value={connectionId} />
      <button type="submit" disabled={pending} className="btn btn--ghost">
        {pending ? "Disconnecting…" : "Disconnect"}
      </button>
      {state?.error ? (
        <span style={{ marginLeft: "var(--space-xs)", fontSize: "var(--text-label)", color: "var(--colour-danger)" }}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
