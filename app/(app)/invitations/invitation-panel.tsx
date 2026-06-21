/**
 * Invitation panel — the first-class view of a user's private invitation link.
 *
 * Server component (presentational); the only interactive part is the shared
 * CopyLinkButton. The tone is deliberate and exclusivity-forward: access is
 * limited, invitations are valuable, and the user is trusted to choose who
 * joins. This is a controlled-access mechanic, not a referral campaign.
 *
 * Three link states, in priority order:
 *   1. paused        — an operator has suspended the link (status: suspended)
 *   2. limit reached — every invitation has been used (derived: limitReached)
 *   3. open          — invitations remain to share
 */

import type { ReferralOverview, ReferralUsageView } from "@/modules/referral";
import { CopyLinkButton } from "@/components/invitations/copy-link-button";

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : dateFormat.format(parsed);
}

type LinkState = "paused" | "limit" | "open";

function linkState(overview: ReferralOverview): LinkState {
  if (overview.status === "suspended") return "paused";
  if (overview.limitReached) return "limit";
  return "open";
}

/** Short status label, e.g. "5 invitations available". */
function statusLabel(overview: ReferralOverview): string {
  switch (linkState(overview)) {
    case "paused":
      return "Link paused";
    case "limit":
      return "Invitation limit reached";
    default:
      return `${overview.remaining} ${
        overview.remaining === 1 ? "invitation" : "invitations"
      } available`;
  }
}

/** Per-person status chip for someone who used the link. */
function usageStatus(usage: ReferralUsageView): { label: string; tone: string } {
  if (usage.onboardingStatus === "expired") {
    return { label: "Expired", tone: "neutral" };
  }
  if (usage.onboardingStatus === "pending") {
    return { label: "Pending signup", tone: "info" };
  }
  return usage.hasWorkspace
    ? { label: "Active", tone: "ok" }
    : { label: "Joined", tone: "info" };
}

export function InvitationPanel({
  overview,
  usages,
}: {
  overview: ReferralOverview;
  usages: ReferralUsageView[];
}) {
  const state = linkState(overview);
  const open = state === "open";

  return (
    <div className="stack" style={{ gap: "var(--space-md)" }}>
      {/* ── The link ───────────────────────────────────────────────────── */}
      <section className="card" style={{ maxWidth: "680px" }}>
        <div className="card-head">
          <div>
            <p className="eyebrow">Invite-only access</p>
            <h2 className="card__title">Your private invitation link</h2>
          </div>
          <span
            className={`status status--${
              open ? "ok" : state === "paused" ? "neutral" : "warn"
            }`}
          >
            {statusLabel(overview)}
          </span>
        </div>

        <p
          className="action-card__rationale"
          style={{ marginBottom: "var(--space-md)" }}
        >
          {open ? (
            <>
              Paylo One is invite-only. Your link gives the people you choose a
              way to request their own workspace. Each invitation is limited.
              Share it with people who would genuinely benefit from a more
              thoughtful way to manage their work, memory, decisions, and
              actions.
            </>
          ) : state === "paused" ? (
            <>
              Your invitation link is paused, so it can&rsquo;t admit anyone for
              now. Your invitations are safe; nothing has been lost.
            </>
          ) : (
            <>
              You&rsquo;ve used every invitation on your link. Strong referrers
              may receive more as the network grows; until then, your link
              won&rsquo;t admit anyone new.
            </>
          )}
        </p>

        {state === "paused" && overview.suspendedReason ? (
          <div
            className="alert alert--warn"
            style={{ marginBottom: "var(--space-md)" }}
          >
            {overview.suspendedReason}
          </div>
        ) : null}

        <div className="meta-row">
          <span className="meta-row__key">Your link</span>
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
            <CopyLinkButton
              link={overview.link}
              disabled={!open}
              className="btn btn--primary btn--sm"
            />
          </span>
        </div>

        <div className="meta-row">
          <span className="meta-row__key">Invitations</span>
          <span className="meta-row__value">
            <span className="badge badge--plain">
              {overview.used} used · {overview.remaining} available ·{" "}
              {overview.allocation} total
            </span>
          </span>
        </div>
      </section>

      {/* ── Who you've invited ─────────────────────────────────────────── */}
      <section className="card" style={{ maxWidth: "680px" }}>
        <div className="card-head">
          <div>
            <p className="eyebrow">Your invitation circle</p>
            <h2 className="card__title">Who you&rsquo;ve invited</h2>
          </div>
        </div>

        {usages.length === 0 ? (
          <div className="empty">
            <p className="empty__title">No one has joined yet</p>
            <p className="empty__body">
              When someone joins through your link, you&rsquo;ll see them here.
              Invite people you trust. The product grows through good
              relationships, not open sign-up.
            </p>
          </div>
        ) : (
          <div className="stack" style={{ gap: 0 }}>
            {usages.map((usage) => {
              const status = usageStatus(usage);
              return (
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
                    <span className={`status status--${status.tone}`}>
                      {status.label}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {open && overview.remaining > 0 ? (
          <p className="field__hint" style={{ marginTop: "var(--space-md)" }}>
            {overview.remaining} {overview.remaining === 1 ? "place" : "places"}{" "}
            still available on your link.
          </p>
        ) : null}
      </section>
    </div>
  );
}
