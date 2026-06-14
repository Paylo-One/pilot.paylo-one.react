"use client";

import { useActionState } from "react";
import {
  activateWorkspace,
  type ActivationState,
} from "./actions";

const initialState: ActivationState = { error: null };

export function ActivationForm({
  token,
  tenantName,
  tenantSlug,
  apexSuffix,
  displayName,
}: {
  token: string;
  tenantName: string;
  tenantSlug: string;
  apexSuffix: string;
  displayName: string;
}) {
  const [state, formAction, pending] = useActionState(
    activateWorkspace,
    initialState,
  );

  return (
    <form className="card onboarding-wizard" action={formAction}>
      <input type="hidden" name="token" value={token} />

      <p className="eyebrow">Final step</p>
      <h2 className="onboarding-wizard__title">Confirm workspace ownership</h2>
      <p className="onboarding-wizard__intro">
        Review the prepared workspace and accept the current legal terms before
        access is activated.
      </p>

      <dl className="onboarding-wizard__summary">
        <div>
          <dt>Workspace</dt>
          <dd>{tenantName}</dd>
        </div>
        <div>
          <dt>Address</dt>
          <dd className="mono">
            {tenantSlug}.{apexSuffix}
          </dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>Owner</dd>
        </div>
      </dl>

      <label className="field">
        <span className="field__label">Display name</span>
        <input
          className="input"
          type="text"
          name="displayName"
          maxLength={100}
          defaultValue={displayName}
        />
      </label>

      <div className="consent">
        <label className="consent__item">
          <input type="checkbox" name="acceptTerms" required />
          <span>
            I agree to the{" "}
            <a href="/terms" target="_blank" rel="noopener noreferrer">
              Terms and Conditions
            </a>
            .
          </span>
        </label>
        <label className="consent__item">
          <input type="checkbox" name="acceptPrivacy" required />
          <span>
            I acknowledge the{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer">
              Privacy Policy
            </a>
            .
          </span>
        </label>
      </div>

      <button
        type="submit"
        className="btn btn--primary btn--block"
        disabled={pending}
        style={{ marginTop: "var(--space-lg)" }}
      >
        {pending ? "Activating workspace..." : "Activate my workspace"}
      </button>

      {state.error ? (
        <p className="form-message form-message--error">{state.error}</p>
      ) : null}
    </form>
  );
}
