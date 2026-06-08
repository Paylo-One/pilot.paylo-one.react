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

  return (
    <form className="card" action={formAction}>
      <div className="field">
        <label htmlFor="workspaceName" className="field__label">
          Workspace name
        </label>
        <input
          id="workspaceName"
          name="workspaceName"
          type="text"
          placeholder="Acme Operations"
          className="input"
        />
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="subdomain" className="field__label">
          Subdomain
        </label>
        <div className="input-suffix">
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
            className="input"
            style={{ flex: 1 }}
          />
          <span className="mono" style={{ color: "var(--colour-text-tertiary)" }}>
            .{apexSuffix}
          </span>
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="btn btn--primary btn--block"
        style={{ marginTop: "var(--space-md)" }}
      >
        {pending ? "Creating workspace…" : "Create workspace"}
      </button>

      {state.error && (
        <p className="form-message form-message--error">{state.error}</p>
      )}
    </form>
  );
}
