import {
  requireTenantContext,
  getSignedInUser,
} from "@/modules/identity-tenant/server";
import { getBillingAccess } from "@/modules/billing/access";
import { BillingActions } from "./billing-actions";

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function trialCopy(freeAccessEndsAt: string, status: string): string {
  const days = Math.ceil(
    (Date.parse(freeAccessEndsAt) - Date.now()) / (24 * 60 * 60 * 1000),
  );
  if (status !== "trialing" || days <= 0) {
    return "Your free access has ended. Choose a plan to continue using Paylo One.";
  }
  if (days === 1) {
    return "Your free access ends tomorrow. Add your subscription now so your workspace keeps running.";
  }
  return `You have ${days} days left in your free access period. Choose a plan to keep your workspace active.`;
}

export default async function BillingPage() {
  const ctx = await requireTenantContext();
  const user = await getSignedInUser();
  const access = await getBillingAccess(ctx.tenantId);

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">Billing</p>
        <h1 className="page-head__title">Plan &amp; access</h1>
        <p className="page-head__lead">
          Manage the subscription that keeps your Paylo One workspace active.
          Payment details are handled securely by Stripe.
        </p>
      </div>

      {!access ? (
        <section className="card" style={{ maxWidth: "760px" }}>
          <div className="card-head">
            <div>
              <p className="eyebrow">Status</p>
              <h2 className="card__title">Billing is being prepared</h2>
            </div>
            <span className="status status--info">Setting up</span>
          </div>
          <p className="action-card__rationale">
            Your workspace is active. Billing access will appear here once the
            invitation setup has finished.
          </p>
        </section>
      ) : (
        <div className="stack" style={{ maxWidth: "820px" }}>
          {access.billingStatus === "trialing" || access.accessStatus === "restricted" ? (
            <div className={`alert ${access.accessStatus === "restricted" ? "alert--risk" : "alert--accent"}`}>
              <p className="alert__title">
                {access.accessStatus === "restricted"
                  ? "Payment required"
                  : "Free access is active"}
              </p>
              <p className="alert__body">
                {trialCopy(access.freeAccessEndsAt, access.billingStatus)}
              </p>
            </div>
          ) : null}

          <section className="card">
            <div className="card-head">
              <div>
                <p className="eyebrow">Current plan</p>
                <h2 className="card__title">Paylo One Personal Operator</h2>
              </div>
              <span
                className={`status ${
                  access.accessStatus === "active" ? "status--ok" : "status--risk"
                }`}
              >
                {access.accessStatus}
              </span>
            </div>

            <div className="meta-row">
              <span className="meta-row__key">Signed in as</span>
              <span className="meta-row__value mono">{user?.email ?? "-"}</span>
            </div>
            <div className="meta-row">
              <span className="meta-row__key">Subscription status</span>
              <span className="meta-row__value">{access.billingStatus}</span>
            </div>
            <div className="meta-row">
              <span className="meta-row__key">Free access ends</span>
              <span className="meta-row__value">
                {formatDate(access.freeAccessEndsAt)}
              </span>
            </div>
            <div className="meta-row">
              <span className="meta-row__key">Current billing period</span>
              <span className="meta-row__value">
                {formatDate(access.currentPeriodStart)} - {formatDate(access.currentPeriodEnd)}
              </span>
            </div>
            <div className="meta-row">
              <span className="meta-row__key">Payment status</span>
              <span className="meta-row__value">
                {access.lastPaymentStatus ?? "No payment recorded yet"}
              </span>
            </div>
            {access.lastPaymentError ? (
              <div className="meta-row">
                <span className="meta-row__key">Payment issue</span>
                <span className="meta-row__value">{access.lastPaymentError}</span>
              </div>
            ) : null}

            <div style={{ marginTop: "var(--space-md)" }}>
              <BillingActions canManage={!!access.stripeCustomerId} />
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
