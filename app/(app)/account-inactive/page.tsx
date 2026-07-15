import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { getBillingAccess } from "@/modules/billing/access";
import { configuredPlanFromPriceId } from "@/modules/billing/stripe";
import { ManageSubscriptionButton } from "../billing/billing-actions";
import { PlanComparison } from "../billing/plan-comparison";

export default async function AccountInactivePage() {
  const ctx = await requireTenantContext();
  const access = await getBillingAccess(ctx.tenantId);
  const configuredPlan = configuredPlanFromPriceId(access?.stripePriceId);
  const t = await getTranslations("account");

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1 className="page-head__title">{t("title")}</h1>
        <p className="page-head__lead">{t("lead")}</p>
      </div>

      <section className="card" style={{ maxWidth: "760px" }}>
        <div className="card-head">
          <div>
            <p className="eyebrow">{t("stateEyebrow")}</p>
            <h2 className="card__title">{t("stateTitle")}</h2>
          </div>
          <span className="status status--risk">
            {access?.billingStatus ?? t("stateFallback")}
          </span>
        </div>
        <p className="action-card__rationale" style={{ marginBottom: "var(--space-md)" }}>
          {t("rationale")}
        </p>
        <ManageSubscriptionButton canManage={!!access?.stripeCustomerId} />
      </section>

      <div style={{ maxWidth: "920px", marginTop: "var(--space-xl)" }}>
        <PlanComparison
          currentPriceOption={configuredPlan?.priceOption.key ?? null}
        />
        <p className="action-card__rationale" style={{ marginTop: "var(--space-md)" }}>
          <Link href="/billing">{t("viewBilling")}</Link>
        </p>
      </div>
    </main>
  );
}
