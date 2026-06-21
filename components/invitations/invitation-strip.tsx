/**
 * components/invitations/invitation-strip.tsx
 *
 * A calm, one-line presence for the user's private invitation link on the
 * daily briefing. Keeps invite-only access visible day to day without
 * competing with "what needs you today" — a quiet affordance, not a promotion.
 * Server component; the only interactive part is the shared copy control.
 */

import Link from "next/link";
import type { ReferralOverview } from "@/modules/referral";
import { CopyLinkButton } from "./copy-link-button";

export function InvitationStrip({ overview }: { overview: ReferralOverview }) {
  const open = overview.status !== "suspended" && !overview.limitReached;

  return (
    <aside
      className="card"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-md)",
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p className="eyebrow" style={{ marginBottom: "var(--space-xs)" }}>
          Invite-only access
        </p>
        <p
          style={{
            fontSize: "var(--text-small)",
            color: "var(--colour-text-secondary)",
            margin: 0,
          }}
        >
          {open ? (
            <>
              You have{" "}
              <strong style={{ color: "var(--colour-text-primary)" }}>
                {overview.remaining}{" "}
                {overview.remaining === 1 ? "invitation" : "invitations"}
              </strong>{" "}
              to share. Pass them to people you trust.
            </>
          ) : overview.status === "suspended" ? (
            <>Your invitation link is paused for now.</>
          ) : (
            <>You&rsquo;ve used every invitation on your link.</>
          )}
        </p>
      </div>
      <div
        style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}
      >
        <CopyLinkButton
          link={overview.link}
          disabled={!open}
          className="btn btn--ghost btn--sm"
          idleLabel="Copy link"
        />
        <Link href="/invitations" className="btn btn--secondary btn--sm">
          Invitations
        </Link>
      </div>
    </aside>
  );
}
