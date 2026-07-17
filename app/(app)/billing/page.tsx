import {
  requireTenantContext,
  getSignedInUser,
} from "@/modules/identity-tenant/server";
import { getBillingAccess } from "@/modules/billing/access";
import { getTenantAccess } from "@/modules/identity-tenant/access";
import { configuredPlanFromPriceId } from "@/modules/billing/stripe";
import { ManageSubscriptionButton } from "./billing-actions";
import { PlanComparison } from "./plan-comparison";

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function restrictedCopy(freeAccessEndsAt: string, status: string): string {
  const ended = Date.parse(freeAccessEndsAt) <= Date.now();
  if (status === "past_due") {
    return "Your last payment did not go through. Update your payment details to resolve the outstanding balance.";
  }
  if (ended) {
    return "Your free billing period has ended. Choose a plan or contact support about your access arrangement.";
  }
  return "Your subscription needs attention. Choose a plan or update your payment details below.";
}

export default async function BillingPage() {
  const ctx = await requireTenantContext();
  const user = await getSignedInUser();
  const [access, tenantAccess] = await Promise.all([
    getBillingAccess(ctx.tenantId),
    getTenantAccess(ctx.tenantId),
  ]);
  const configuredPlan = configuredPlanFromPriceId(access?.stripePriceId);
  const currentPlanName = configuredPlan?.tier.name ?? "Personal Operator";

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">Billing</p>
        <h1 className="page-head__title">Plan &amp; billing</h1>
        <p className="page-head__lead">
          Choose the plan that fits how you operate. Compare Personal Operator
          and Executive Operator below — payment details are handled securely by
          Stripe.
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
        <div className="stack" style={{ maxWidth: "920px", gap: "var(--space-xl)" }}>
          {access.accessStatus === "restricted" ? (
            <div className="alert alert--risk">
              <p className="alert__title">Payment needs attention</p>
              <p className="alert__body">
                {restrictedCopy(access.freeAccessEndsAt, access.billingStatus)}
              </p>
            </div>
          ) : null}

          <PlanComparison
            currentPriceOption={configuredPlan?.priceOption.key ?? null}
          />

          <section className="card">
            <div className="card-head">
              <div>
                <p className="eyebrow">Current plan</p>
                <h2 className="card__title">Paylo One {currentPlanName}</h2>
              </div>
              <span
                className={`status ${
                  tenantAccess?.status === "active" ? "status--ok" : "status--risk"
                }`}
              >
                Access: {tenantAccess?.status ?? "unknown"}
              </span>
            </div>

            <div className="meta-row">
              <span className="meta-row__key">Signed in as</span>
              <span className="meta-row__value mono">{user?.email ?? "-"}</span>
            </div>
            <div className="meta-row">
              <span className="meta-row__key">Access basis</span>
              <span className="meta-row__value">
                {tenantAccess?.accessGrantType ?? "paid"}
                {tenantAccess?.paymentEnforcementExempt ? " · payment exempt" : ""}
              </span>
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
              <ManageSubscriptionButton canManage={!!access.stripeCustomerId} />
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
