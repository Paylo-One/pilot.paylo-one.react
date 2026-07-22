/**
 * app/(auth)/onboarding/page.tsx
 *
 * First-login onboarding on the apex/neutral host. If the user already has a
 * workspace, forward to it; otherwise show the subdomain-claim form.
 */

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { RegistrationProgress } from "@/components/registration-progress";
import {
  getSignedInUser,
  findPrimaryTenantSlug,
} from "@/modules/identity-tenant/server";
import { REFERRAL_COOKIE, referralService } from "@/modules/referral";
import { hasUnlinkedPaddleSubscriptionForEmail } from "@/modules/billing/paddle-webhooks";
import { tenantBaseUrl, activeApex } from "@/lib/config";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = {
  title: "Create your workspace · Paylo.one",
  robots: { index: false, follow: false },
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const user = await getSignedInUser();
  if (!user) redirect("/sign-in");

  const existing = await findPrimaryTenantSlug(user.userId);
  if (existing) redirect(tenantBaseUrl(existing));

  // The apex `paylo_ref` cookie is the primary carrier, but it can be lost over
  // the magic-link round-trip; `?ref=` (threaded through the link) is the
  // fallback. Re-validated below regardless of source.
  const cookieRef = (await cookies()).get(REFERRAL_COOKIE)?.value;
  const { ref: urlRef } = await searchParams;
  const candidateReferralCode = cookieRef ?? urlRef;
  const validation = candidateReferralCode
    ? await referralService.validateCode(candidateReferralCode)
    : null;
  const referralCode =
    validation?.ok && validation.value.status === "valid"
      ? candidateReferralCode
      : undefined;

  let hasPaidCheckout = false;
  if (!referralCode && user.email) {
    try {
      hasPaidCheckout = await hasUnlinkedPaddleSubscriptionForEmail(user.email);
    } catch {
      redirect("/invite-unavailable?reason=unavailable");
    }
  }

  if (!referralCode && !hasPaidCheckout) {
    const reason =
      validation?.ok &&
      (validation.value.status === "exhausted" ||
        validation.value.status === "suspended")
        ? "limit-reached"
        : validation?.ok
          ? "invalid"
          : candidateReferralCode
            ? "unavailable"
            : "referral-required";
    redirect(`/invite-unavailable?reason=${reason}`);
  }

  return (
    <>
      <RegistrationProgress current={3} />

      <p className="eyebrow">Identity verified</p>
      <h1
        style={{
          fontSize: "var(--text-h1)",
          margin: "var(--space-xs) 0 var(--space-sm)",
        }}
      >
        Set up your private workspace
      </h1>
      <p
        className="text-secondary"
        style={{
          marginBottom: "var(--space-lg)",
          fontSize: "var(--text-small)",
        }}
      >
        Choose a name and your own Paylo.one address. Every row, file, and
        reference stays isolated inside this workspace.
      </p>

      <OnboardingForm apexSuffix={activeApex()} referralCode={referralCode} />
    </>
  );
}
