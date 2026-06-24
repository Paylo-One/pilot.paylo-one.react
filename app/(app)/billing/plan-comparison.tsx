"use client";

import { useState } from "react";
import {
  STRIPE_BILLING_PRICE_OPTIONS,
  STRIPE_BILLING_TIERS,
  type StripeBillingInterval,
  type StripeBillingPriceOption,
} from "@/modules/billing/stripe-plans";
import { PLAN_CONTENT, PLAN_MATRIX } from "./plan-content";

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M2.5 7.5L5.5 10.5L11.5 3.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MatrixCell({ value }: { value: string | boolean }) {
  if (value === true) {
    return (
      <span className="plan-matrix__yes" aria-label="Included">
        <Check />
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="plan-matrix__no mono" aria-label="Not included">
        —
      </span>
    );
  }
  return <span className="plan-matrix__val">{value}</span>;
}

async function postForUrl(path: string, body?: unknown): Promise<string> {
  const response = await fetch(path, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };
  if (!response.ok || !payload.url) {
    throw new Error(payload.error ?? "Could not start billing flow.");
  }
  return payload.url;
}

export function PlanComparison({
  currentPriceOption,
}: {
  currentPriceOption: StripeBillingPriceOption["key"] | null;
}) {
  const currentInterval = STRIPE_BILLING_PRICE_OPTIONS.find(
    (option) => option.key === currentPriceOption,
  )?.interval;
  const [cadence, setCadence] = useState<StripeBillingInterval>(
    currentInterval ?? "monthly",
  );
  const [busy, setBusy] = useState<StripeBillingPriceOption["key"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(option: StripeBillingPriceOption) {
    setBusy(option.key);
    setError(null);
    try {
      const url = await postForUrl("/api/billing/create-checkout-session", {
        priceOption: option.key,
      });
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Billing flow failed.");
      setBusy(null);
    }
  }

  return (
    <section className="stack" style={{ gap: "var(--space-md)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-md)",
          flexWrap: "wrap",
        }}
      >
        <div>
          <p className="eyebrow">Plans</p>
          <h2 className="card__title">Compare plans</h2>
        </div>
        <div className="billing-toggle" aria-label="Billing cadence">
          <button
            type="button"
            className={`billing-toggle__option${cadence === "monthly" ? " billing-toggle__option--active" : ""}`}
            aria-pressed={cadence === "monthly"}
            onClick={() => setCadence("monthly")}
          >
            Monthly
          </button>
          <button
            type="button"
            className={`billing-toggle__option${cadence === "annual" ? " billing-toggle__option--active" : ""}`}
            aria-pressed={cadence === "annual"}
            onClick={() => setCadence("annual")}
          >
            Annually
          </button>
        </div>
      </div>

      <div className="plan-grid">
        {STRIPE_BILLING_TIERS.map((tier) => {
          const content = PLAN_CONTENT[tier.key];
          const option = STRIPE_BILLING_PRICE_OPTIONS.find(
            (o) => o.tierKey === tier.key && o.interval === cadence,
          );
          if (!option) return null;
          const isCurrent = option.key === currentPriceOption;
          return (
            <article
              className={`plan-card${content.featured ? " plan-card--featured" : ""}`}
              key={tier.key}
            >
              <span className="plan-card__tag mono">{content.accessTag}</span>
              <h3 className="plan-card__name">{tier.name}</h3>
              <p className="plan-card__audience">{content.audience}</p>

              <div className="plan-card__price">{option.displayPrice}</div>
              <div className="plan-card__cadence">{option.displayCadence}</div>

              <p className="plan-card__summary">{tier.summary}</p>

              <ul className="plan-includes">
                {content.includes.map((inc) => (
                  <li className="plan-include" key={inc}>
                    <Check />
                    <span>{inc}</span>
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <span className="plan-card__current">Current plan</span>
              ) : (
                <button
                  type="button"
                  className={`btn ${content.featured ? "btn--primary" : "btn--secondary"} plan-card__cta`}
                  disabled={busy !== null}
                  onClick={() => startCheckout(option)}
                >
                  {busy === option.key ? "Opening…" : `Choose ${tier.name}`}
                </button>
              )}
            </article>
          );
        })}
      </div>

      {error ? <p className="alert alert--risk">{error}</p> : null}

      <div className="plan-matrix-wrap">
        <table className="plan-matrix">
          <caption
            className="label"
            style={{ textAlign: "left", padding: "var(--space-md)" }}
          >
            What is included at each plan
          </caption>
          <thead>
            <tr>
              <th scope="col">Capability</th>
              {STRIPE_BILLING_TIERS.map((tier) => (
                <th scope="col" key={tier.key}>
                  {tier.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PLAN_MATRIX.map((row) => (
              <tr key={row.feature}>
                <td>{row.feature}</td>
                {row.values.map((value, i) => (
                  <td key={`${row.feature}-${i}`}>
                    <MatrixCell value={value} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
