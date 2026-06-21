import Link from "next/link";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { getBillingAccess } from "@/modules/billing/access";
import { configuredPlanFromPriceId } from "@/modules/billing/stripe";
import { BillingActions } from "../billing/billing-actions";

export default async function AccountInactivePage() {
  const ctx = await requireTenantContext();
  const access = await getBillingAccess(ctx.tenantId);
  const configuredPlan = configuredPlanFromPriceId(access?.stripePriceId);

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">Account inactive</p>
        <h1 className="page-head__title">Billing needs attention</h1>
        <p className="page-head__lead">
          You can still sign in and manage your account, but workspace features
          are paused until billing is active again.
        </p>
      </div>

      <section className="card" style={{ maxWidth: "760px" }}>
        <div className="card-head">
          <div>
            <p className="eyebrow">Access state</p>
            <h2 className="card__title">Core features are paused</h2>
          </div>
          <span className="status status--risk">
            {access?.billingStatus ?? "restricted"}
          </span>
        </div>
        <p className="action-card__rationale" style={{ marginBottom: "var(--space-md)" }}>
          Choose a plan, update payment details, or restart your subscription to
          restore access to briefing, actions, diary, sources, and intelligence.
        </p>
        <BillingActions
          canManage={!!access?.stripeCustomerId}
          currentPriceOption={configuredPlan?.priceOption.key ?? null}
        />
        <p className="action-card__rationale" style={{ marginTop: "var(--space-md)" }}>
          <Link href="/billing">View billing details</Link>
        </p>
      </section>
    </main>
  );
}
