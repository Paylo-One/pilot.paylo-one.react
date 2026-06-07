/**
 * app/(auth)/onboarding/page.tsx
 *
 * First-login onboarding on the apex/neutral host. If the user already has a
 * workspace, forward to it; otherwise show the subdomain-claim form.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  getSignedInUser,
  findPrimaryTenantSlug,
} from "@/modules/identity-tenant/server";
import { tenantBaseUrl, activeApex } from "@/lib/config";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = {
  title: "Create your workspace · Paylo.one",
  robots: { index: false, follow: false },
};

export default async function OnboardingPage() {
  const user = await getSignedInUser();
  if (!user) redirect("/sign-in");

  const existing = await findPrimaryTenantSlug(user.userId);
  if (existing) redirect(tenantBaseUrl(existing));

  return (
    <>
      <p className="eyebrow">Welcome</p>
      <h1 style={{ fontSize: "var(--text-h2)", margin: "8px 0 16px" }}>
        Create your private workspace
      </h1>
      <p style={{ color: "var(--colour-text-secondary)", marginBottom: "var(--space-lg)" }}>
        Choose a subdomain for your isolated operating layer. You will work at{" "}
        <span className="mono">&lt;subdomain&gt;.{activeApex()}</span>.
      </p>

      <OnboardingForm apexSuffix={activeApex()} />
    </>
  );
}
