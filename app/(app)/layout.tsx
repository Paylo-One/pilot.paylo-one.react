/**
 * app/(app)/layout.tsx
 *
 * The tenant workspace shell, served on <slug>.paylo.one. It is built to feel
 * like a calm command layer, not a dashboard: a permanent dark command layer
 * (sidebar) carrying brand, tenant context, and navigation, beside a calm main
 * column with a context-bearing topbar.
 *
 * Surfaces follow product/screen-map.md: Briefing, Actions, Diary (the wedge),
 * with Sources and the Tenant Tool Layer (MCP) as system surfaces and Settings
 * under Account.
 *
 * Tenant context is resolved server-side (verified session + validated host
 * slug -> { userId, tenantId, role }, with tenant_users membership enforced)
 * and fails closed via redirect when the visitor is not a member. Governance:
 * multi-tenancy-design.md, authentication-architecture.md §8.
 */

import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import {
  requireTenantContextForAccessGate,
  getSignedInUser,
} from "@/modules/identity-tenant/server";
import { enforceBillingAccessForPath } from "@/modules/billing/access-guard";
import { getBillingAccess } from "@/modules/billing/access";
import { TrialBanner } from "@/components/trial-banner";
import { BrandMark } from "@/components/brand-mark";
import { PayloWordmark } from "@/components/paylo-wordmark";
import { WorkspaceNav } from "@/components/workspace-nav";
import { MobileNav } from "@/components/mobile-nav";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { resolveActiveLocale } from "@/i18n/request";
import { formatDate } from "@/lib/i18n/format";

/** Message key for the time-of-day greeting. */
function greetingKey(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Fails closed (redirects) when not signed in / not a member of this tenant.
  const ctx = await requireTenantContextForAccessGate();
  const requestHeaders = await headers();
  const tenantAccess = await enforceBillingAccessForPath(
    ctx,
    requestHeaders.get("x-paylo-request-path"),
  );
  if (tenantAccess.status === "suspended") {
    return <div className="workspace__main">{children}</div>;
  }
  const user = await getSignedInUser();
  const billingAccess = await getBillingAccess(ctx.tenantId);

  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("display_name, timezone, briefing_time, onboarding_completed")
    .eq("user_id", ctx.userId)
    .maybeSingle();

  const locale = await resolveActiveLocale();
  const t = await getTranslations("shell");
  const tc = await getTranslations("common");
  const now = new Date();
  const dateLabel = formatDate(locale, now, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="workspace">
      {!profile?.onboarding_completed && (
        <OnboardingWizard profile={profile} />
      )}
      {/* --- Command layer ------------------------------------------------- */}
      <aside className="workspace__sidebar">
        <div className="brand">
          <BrandMark size={26} className="brand__mark" />
          <div className="brand__wordmark">
            <PayloWordmark size={17} />
            <span className="brand__inst">Pilot</span>
          </div>
        </div>

        <div className="tenant-chip" title={t("workspace.tenantTitle")}>
          <span className="tenant-chip__dot" aria-hidden="true" />
          <div className="tenant-chip__body">
            <div className="tenant-chip__label">{t("workspace.label")}</div>
            <div className="tenant-chip__value">
              {ctx.tenantSlug}.paylo.one
            </div>
          </div>
        </div>

        <WorkspaceNav />

        <div className="nav__footer">
          <span className="nav__operator" title={user?.email ?? undefined}>
            {user?.email ?? t("operator")}
          </span>
          <form action="/auth/signout" method="post">
            <button type="submit" className="nav__signout">
              <svg
                className="nav__icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5M21 12H9" />
              </svg>
              <span>{tc("actions.signOut")}</span>
            </button>
          </form>
        </div>
      </aside>

      {/* --- Main column --------------------------------------------------- */}
      <div className="workspace__main">
        <header className="topbar">
          <MobileNav tenantSlug={ctx.tenantSlug} email={user?.email ?? null} />
          <div className="topbar__brand" aria-hidden="true">
            <PayloWordmark size={15} />
          </div>
          <div className="topbar__context">
            <span className="topbar__date">{dateLabel}</span>
            <span className="topbar__greeting">
              {t(`greeting.${greetingKey(now.getHours())}`)}
            </span>
          </div>
          <div className="topbar__indicators">
            {/* System indicators are scaffold-level: they reflect designed
                status surfaces, not a live sync/generation pipeline. */}
            <span className="status-pill" title={t("status.sourcesTitle")}>
              <span className="status-pill__dot status-pill__dot--ok" />
              {t("status.sourcesIdle")}
            </span>
            <span className="status-pill" title={t("status.briefingTitle")}>
              <span className="status-pill__dot status-pill__dot--accent" />
              {t("status.briefingReady")}
            </span>
          </div>
        </header>
        {billingAccess?.billingStatus === "trialing" ? (
          <TrialBanner endsAt={billingAccess.freeAccessEndsAt} />
        ) : null}
        {children}
      </div>
    </div>
  );
}
