"use client";

/**
 * Onboarding form: pick a workspace name + subdomain, submit to the
 * createWorkspace server action, which provisions the tenant and redirects to
 * the new <slug>.<apex> workspace.
 */

import { useActionState } from "react";
import { createWorkspace, type OnboardingState } from "./actions";

const initial: OnboardingState = { error: null };

export function OnboardingForm({ apexSuffix }: { apexSuffix: string }) {
  const [state, formAction, pending] = useActionState(createWorkspace, initial);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--colour-border-strong)",
    background: "var(--colour-surface)",
    color: "var(--colour-text-primary)",
    fontSize: "var(--text-body)",
  };

  return (
    <form className="panel" action={formAction}>
      <label htmlFor="workspaceName" className="eyebrow" style={{ display: "block", marginBottom: "var(--space-sm)" }}>
        Workspace name
      </label>
      <input id="workspaceName" name="workspaceName" type="text" placeholder="Acme Operations" style={inputStyle} />

      <label
        htmlFor="subdomain"
        className="eyebrow"
        style={{ display: "block", margin: "var(--space-md) 0 var(--space-sm)" }}
      >
        Subdomain
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
        <input
          id="subdomain"
          name="subdomain"
          type="text"
          required
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="bernard"
          pattern="[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])"
          style={{ ...inputStyle, flex: 1 }}
        />
        <span className="mono" style={{ color: "var(--colour-text-tertiary)" }}>
          .{apexSuffix}
        </span>
      </div>

      <button
        type="submit"
        disabled={pending}
        style={{
          marginTop: "var(--space-md)",
          width: "100%",
          padding: "10px 12px",
          borderRadius: "var(--radius-md)",
          border: "none",
          background: "var(--colour-accent)",
          color: "var(--colour-accent-on)",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {pending ? "Creating workspace…" : "Create workspace"}
      </button>

      {state.error && (
        <p style={{ color: "var(--colour-danger, #9e3c34)", marginTop: "var(--space-sm)" }}>
          {state.error}
        </p>
      )}
    </form>
  );
}
