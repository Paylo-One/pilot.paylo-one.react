"use client";

import { useActionState, useRef, useState } from "react";
import { createWorkspace, type OnboardingState } from "./actions";

const initial: OnboardingState = { error: null };

type WizardStep = 1 | 2 | 3;

export function OnboardingForm({
  apexSuffix,
  referralCode,
  requirePayloLegalAcceptance,
}: {
  apexSuffix: string;
  /** Threaded into the action so referral capture survives a lost cookie. */
  referralCode?: string;
  /** Hosted Paylo signup accepts Paylo terms; self-host operators supply their own. */
  requirePayloLegalAcceptance: boolean;
}) {
  const [state, formAction, pending] = useActionState(createWorkspace, initial);
  const [step, setStep] = useState<WizardStep>(1);
  const [workspaceName, setWorkspaceName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const subdomainRef = useRef<HTMLInputElement>(null);

  function continueToAddress() {
    setStep(2);
  }

  function continueToReview() {
    if (subdomainRef.current?.reportValidity()) setStep(3);
  }

  return (
    <form className="card onboarding-wizard" action={formAction}>
      {referralCode ? (
        <input type="hidden" name="referralCode" value={referralCode} />
      ) : null}
      <ol
        className="onboarding-wizard__progress"
        aria-label="Workspace setup progress"
      >
        {["Workspace", "Address", "Confirm"].map((label, index) => {
          const number = (index + 1) as WizardStep;
          return (
            <li
              key={label}
              className={
                number === step
                  ? "onboarding-wizard__progress-item onboarding-wizard__progress-item--current"
                  : number < step
                    ? "onboarding-wizard__progress-item onboarding-wizard__progress-item--complete"
                    : "onboarding-wizard__progress-item"
              }
              aria-current={number === step ? "step" : undefined}
            >
              <span>{number < step ? "✓" : number}</span>
              {label}
            </li>
          );
        })}
      </ol>

      <section hidden={step !== 1} aria-labelledby="workspace-step-title">
        <p className="eyebrow">Step 1 of 3</p>
        <h2 id="workspace-step-title" className="onboarding-wizard__title">
          Name your workspace
        </h2>
        <p className="onboarding-wizard__intro">
          Use your company, team, or own name. You can refine this later.
        </p>

        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="workspaceName" className="field__label">
            Workspace name
          </label>
          <input
            id="workspaceName"
            name="workspaceName"
            type="text"
            maxLength={80}
            value={workspaceName}
            onChange={(event) => setWorkspaceName(event.target.value)}
            placeholder="Acme Operations"
            className="input"
          />
          <p className="field__hint">Optional. Your address is chosen next.</p>
        </div>

        <button
          type="button"
          className="btn btn--primary btn--block"
          style={{ marginTop: "var(--space-lg)" }}
          onClick={continueToAddress}
        >
          Continue to address
        </button>
      </section>

      <section hidden={step !== 2} aria-labelledby="address-step-title">
        <p className="eyebrow">Step 2 of 3</p>
        <h2 id="address-step-title" className="onboarding-wizard__title">
          Choose your Paylo.one address
        </h2>
        <p className="onboarding-wizard__intro">
          This is the private URL you will use to open your workspace.
        </p>

        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="subdomain" className="field__label">
            Workspace address
          </label>
          <div className="input-suffix">
            <input
              ref={subdomainRef}
              id="subdomain"
              name="subdomain"
              type="text"
              required
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={subdomain}
              onChange={(event) =>
                setSubdomain(
                  event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                )
              }
              placeholder="acme"
              pattern="[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])"
              className="input"
              style={{ flex: 1 }}
            />
            <span className="mono onboarding-wizard__suffix">
              .{apexSuffix}
            </span>
          </div>
          <p className="field__hint">Use 3–32 letters, numbers, or hyphens.</p>
        </div>

        <div className="onboarding-wizard__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setStep(1)}
          >
            Back
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={continueToReview}
          >
            Review setup
          </button>
        </div>
      </section>

      <section hidden={step !== 3} aria-labelledby="confirm-step-title">
        <p className="eyebrow">Step 3 of 3</p>
        <h2 id="confirm-step-title" className="onboarding-wizard__title">
          Confirm and create
        </h2>
        <p className="onboarding-wizard__intro">
          {requirePayloLegalAcceptance
            ? "Check your workspace details and confirm the legal terms."
            : "Check your workspace details before creating it."}
        </p>

        <dl className="onboarding-wizard__summary">
          <div>
            <dt>Workspace</dt>
            <dd>{workspaceName.trim() || subdomain}</dd>
          </div>
          <div>
            <dt>Address</dt>
            <dd className="mono">
              {subdomain}.{apexSuffix}
            </dd>
          </div>
          <div>
            <dt>Access</dt>
            <dd>Private and identity verified</dd>
          </div>
        </dl>

        {requirePayloLegalAcceptance ? (
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
        ) : null}

        <div className="onboarding-wizard__actions">
          <button
            type="button"
            className="btn btn--secondary"
            disabled={pending}
            onClick={() => setStep(2)}
          >
            Back
          </button>
          <button type="submit" disabled={pending} className="btn btn--primary">
            {pending ? "Creating workspace…" : "Create my workspace"}
          </button>
        </div>
      </section>

      {state.error && (
        <p className="form-message form-message--error">{state.error}</p>
      )}
    </form>
  );
}
