"use client";

/**
 * The public Request access form. Collects the minimum useful detail — name,
 * email, optional company or role, and a short reason — and submits through the
 * server action. On success it swaps the form for a calm confirmation; on error
 * it shows a single plain-language message and keeps what was typed.
 */

import { useActionState } from "react";
import Link from "next/link";
import { requestAccessAction } from "./actions";
import { initialRequestAccessState } from "./types";

export function RequestAccessForm() {
  const [state, action, pending] = useActionState(
    requestAccessAction,
    initialRequestAccessState,
  );

  if (state.status === "ok") {
    return (
      <div className="card" role="status" aria-live="polite">
        <div className="card-head">
          <div>
            <p className="eyebrow">Request received</p>
            <h2 className="card__title">Thank you — we have your request</h2>
          </div>
          <span className="status status--ok">Received</span>
        </div>
        <p className="text-secondary" style={{ fontSize: "var(--text-small)" }}>
          Onboarding is deliberate and hands-on, so we review every request
          personally. If it is a fit, we will reach out by email with an
          invitation and next steps. There is nothing else you need to do.
        </p>
        <div style={{ marginTop: "var(--space-lg)" }}>
          <Link href="/sign-in" className="btn btn--secondary">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="card">
      <div className="field">
        <label className="field__label" htmlFor="ra-name">
          Name
        </label>
        <input
          id="ra-name"
          name="name"
          type="text"
          required
          autoComplete="name"
          className="input"
          placeholder="Your full name"
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="ra-email">
          Work email
        </label>
        <input
          id="ra-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="input"
          placeholder="you@company.com"
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="ra-company">
          Company or role
        </label>
        <input
          id="ra-company"
          name="companyOrRole"
          type="text"
          className="input"
          placeholder="e.g. CTO at Northwind, or fractional CTO"
        />
        <span className="field__hint">Optional, but it helps us understand the fit.</span>
      </div>

      <div className="field" style={{ marginBottom: "var(--space-md)" }}>
        <label className="field__label" htmlFor="ra-reason">
          What are you hoping it will help with?
        </label>
        <textarea
          id="ra-reason"
          name="reason"
          rows={4}
          className="textarea"
          placeholder="A sentence or two about your context and what you want to get on top of."
        />
      </div>

      {state.status === "error" && state.message ? (
        <p className="form-message form-message--error" role="alert">
          {state.message}
        </p>
      ) : null}

      <div
        style={{
          display: "flex",
          gap: "var(--space-sm)",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button type="submit" className="btn btn--primary" disabled={pending}>
          {pending ? "Sending…" : "Request access"}
        </button>
        <Link href="/sign-in" className="btn btn--ghost">
          I already have an account
        </Link>
      </div>
    </form>
  );
}
