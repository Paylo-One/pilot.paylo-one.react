"use client";

/**
 * Referral card (every user). Shows the user's personal reference, how many of
 * their invitations are used/remaining, the reference status (active/suspended),
 * and who has joined through it. Calm and exclusivity-forward — a controlled
 * access mechanism, not a growth-hack referral campaign. Read-only: the code is
 * created automatically and consumed during others' onboarding.
 */

import { useState } from "react";
import type { ReferralOverview, ReferralUsageView } from "@/modules/referral";

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : dateFormat.format(parsed);
}

export function ReferralCard({
  overview,
  usages,
}: {
  overview: ReferralOverview;
  usages: ReferralUsageView[];
}) {
  const [copied, setCopied] = useState(false);
  const suspended = overview.status === "suspended";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(overview.link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the full link is in the title attribute.
    }
  }

  return (
    <>
      <p
        className="action-card__rationale"
        style={{ marginBottom: "var(--space-md)" }}
      >
        {suspended
          ? "Your reference is paused — all of your invitations have been used."
          : `You have ${overview.remaining} of ${overview.allocation} invitations to share. Your reference gives selected people access to join — share it with people you trust.`}
      </p>

      <div className="meta-row">
        <span className="meta-row__key">Your reference</span>
        <span
          className="meta-row__value"
          style={{
            display: "flex",
            gap: "var(--space-sm)",
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <span className="mono">{overview.code}</span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={copyLink}
            title={overview.link}
            disabled={suspended}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </span>
      </div>

      <div className="meta-row">
        <span className="meta-row__key">Invitations</span>
        <span className="meta-row__value">
          <span className="badge badge--plain">
            {overview.used} used · {overview.remaining} remaining ·{" "}
            {overview.allocation} total
          </span>
        </span>
      </div>

      <div className="meta-row">
        <span className="meta-row__key">Reference status</span>
        <span className="meta-row__value">
          <span className={`status status--${suspended ? "neutral" : "ok"}`}>
            {suspended ? "Suspended" : "Active"}
          </span>
        </span>
      </div>

      {suspended ? (
        <p className="field__hint" style={{ marginTop: "var(--space-md)" }}>
          No further sign-ups can use this reference unless additional
          invitations are granted in the future.
        </p>
      ) : null}

      <div style={{ marginTop: "var(--space-lg)" }}>
        <p className="eyebrow" style={{ marginBottom: "var(--space-sm)" }}>
          Who has joined
        </p>
        {usages.length === 0 ? (
          <div className="empty">
            <p className="empty__title">No one has joined yet</p>
            <p className="empty__body">
              Share your reference with people you trust. You&rsquo;ll be able to
              see who joins through it here.
            </p>
          </div>
        ) : (
          <div className="stack" style={{ gap: 0 }}>
            {usages.map((usage) => (
              <div className="meta-row" key={usage.id}>
                <span className="meta-row__key" style={{ minWidth: 0 }}>
                  <span style={{ color: "var(--colour-text-primary)" }}>
                    {usage.referredName ?? usage.referredEmail ?? "New member"}
                  </span>
                  <span
                    className="mono"
                    style={{
                      display: "block",
                      fontSize: "var(--text-label)",
                      color: "var(--colour-text-tertiary)",
                    }}
                  >
                    Joined {formatDate(usage.createdAt)}
                  </span>
                </span>
                <span className="meta-row__value">
                  <span
                    className={`status status--${usage.hasWorkspace ? "ok" : "info"}`}
                  >
                    {usage.hasWorkspace ? "Active" : "Onboarding"}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
