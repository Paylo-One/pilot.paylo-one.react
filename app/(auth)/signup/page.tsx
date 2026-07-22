import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegistrationProgress } from "@/components/registration-progress";
import { getSignedInUser } from "@/modules/identity-tenant/server";
import { SignInForm } from "../sign-in/sign-in-form";

export const metadata: Metadata = {
  title: "Set up your account · Paylo.one",
  robots: { index: false, follow: false },
};

/** Account setup after an anonymous Paddle checkout on the marketing site. */
export default async function SignupPage() {
  const user = await getSignedInUser();
  if (user) redirect("/onboarding");

  return (
    <>
      <RegistrationProgress current={2} />

      <p className="eyebrow">Payment received</p>
      <h1
        style={{
          fontSize: "var(--text-h1)",
          margin: "var(--space-xs) 0 var(--space-sm)",
        }}
      >
        Set up your account
      </h1>
      <p
        className="text-secondary"
        style={{
          marginBottom: "var(--space-lg)",
          fontSize: "var(--text-small)",
        }}
      >
        Use the same email address you entered at checkout. We will send a
        one-time link to verify it, then help you create your workspace.
      </p>

      <SignInForm mode="registration" />

      <p className="scaffold-note" style={{ marginTop: "var(--space-lg)" }}>
        Already have a Paylo.one account?{" "}
        <a href="/sign-in?existing=1">Sign in instead</a>.
      </p>
    </>
  );
}
