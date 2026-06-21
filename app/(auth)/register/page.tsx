import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { RegistrationProgress } from "@/components/registration-progress";
import { getSignedInUser } from "@/modules/identity-tenant/server";
import { REFERRAL_COOKIE, referralService } from "@/modules/referral";
import { SignInForm } from "../sign-in/sign-in-form";

export const metadata: Metadata = {
  title: "Create your account · Paylo.one",
  robots: { index: false, follow: false },
};

function unavailableReason(status: string): string {
  return status === "exhausted" || status === "suspended"
    ? "limit-reached"
    : "invalid";
}

export default async function RegisterPage() {
  const user = await getSignedInUser();
  if (user) redirect("/onboarding");

  const referralCode = (await cookies()).get(REFERRAL_COOKIE)?.value;
  if (!referralCode) redirect("/invite-unavailable?reason=referral-required");

  const validation = await referralService.validateCode(referralCode);
  if (!validation.ok || validation.value.status !== "valid") {
    const reason = validation.ok
      ? unavailableReason(validation.value.status)
      : "unavailable";
    redirect(`/invite-unavailable?reason=${reason}`);
  }

  return (
    <>
      <RegistrationProgress current={2} />

      <p className="eyebrow">Invitation confirmed</p>
      <h1
        style={{
          fontSize: "var(--text-h1)",
          margin: "var(--space-xs) 0 var(--space-sm)",
        }}
      >
        Verify your email
      </h1>
      <p
        className="text-secondary"
        style={{
          marginBottom: "var(--space-lg)",
          fontSize: "var(--text-small)",
        }}
      >
        Your invitation is valid. Welcome. We will send a one-time link to
        verify your identity, then help you choose your workspace name and
        Paylo.one address.
      </p>

      <SignInForm mode="registration" />

      <p className="scaffold-note" style={{ marginTop: "var(--space-lg)" }}>
        Already have a Paylo.one account?{" "}
        <a href="/sign-in?existing=1">Sign in instead</a>.
      </p>
    </>
  );
}
