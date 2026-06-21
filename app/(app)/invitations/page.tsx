/**
 * Invitations — the dedicated home for a user's private invitation link.
 *
 * Server component. Reads the signed-in user's personal referral overview and
 * the people who have joined through it, then hands them to InvitationPanel.
 * Invite-only access is a deliberate part of how Paylo One grows, so this gets
 * its own surface rather than living as one card in Settings.
 *
 * Governance: product/access-and-invitations.md.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import { referralService } from "@/modules/referral";
import { InvitationPanel } from "./invitation-panel";

export const metadata = {
  title: "Invitations",
};

export default async function InvitationsPage() {
  const ctx = await requireTenantContext();

  const [overviewRes, usagesRes] = await Promise.all([
    referralService.getOverview(ctx),
    referralService.listUsages(ctx),
  ]);
  const overview = overviewRes.ok ? overviewRes.value : null;
  const usages = usagesRes.ok ? usagesRes.value : [];

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">Invitations</p>
        <h1 className="page-head__title">Invite people you trust</h1>
        <p className="page-head__lead">
          Paylo One is invite-only. Your private link lets the people you choose
          request their own workspace. It is a quiet way to bring the right
          operators, founders, and managers into the network. Share it carefully.
        </p>
      </div>

      {overview ? (
        <InvitationPanel overview={overview} usages={usages} />
      ) : (
        <section className="card" style={{ maxWidth: "680px" }}>
          <p className="action-card__rationale">
            Your invitation link is being prepared. Refresh in a moment to see
            it.
          </p>
        </section>
      )}
    </main>
  );
}
