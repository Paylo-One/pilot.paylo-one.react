import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RegistrationProgress } from "@/components/registration-progress";
import { SignInForm } from "@/app/(auth)/sign-in/sign-in-form";
import {
  inspectPreparedActivation,
  isActivationToken,
} from "@/modules/identity-tenant/activation";
import { getSignedInUser } from "@/modules/identity-tenant/server";
import { activeApex, tenantBaseUrl } from "@/lib/config";
import { ActivationForm } from "./activation-form";

export const metadata: Metadata = {
  title: "Activate workspace · Paylo.one",
  robots: { index: false, follow: false },
};

function maskedEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(2, local.length - visible.length))}@${domain}`;
}

export default async function ActivateWorkspacePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!isActivationToken(token)) {
    return <Unavailable message="This activation link is invalid." />;
  }

  const invitation = await inspectPreparedActivation(token);
  if (!invitation) {
    return <Unavailable message="This activation invitation was not found." />;
  }
  if (invitation.status === "expired") {
    return (
      <Unavailable message="This activation link has expired. Ask Operations for a new link." />
    );
  }
  if (invitation.status === "revoked") {
    return <Unavailable message="This activation link is no longer active." />;
  }

  const user = await getSignedInUser();
  if (invitation.status === "accepted") {
    if (user?.userId === invitation.acceptedUserId) {
      redirect(tenantBaseUrl(invitation.tenantSlug));
    }
    return <Unavailable message="This activation link has already been used." />;
  }

  if (!user) {
    return (
      <>
        <RegistrationProgress current={2} />
        <p className="eyebrow">Owner invitation</p>
        <h1
          style={{
            fontSize: "var(--text-h1)",
            margin: "var(--space-xs) 0 var(--space-sm)",
          }}
        >
          Verify your identity
        </h1>
        <p
          className="text-secondary"
          style={{
            marginBottom: "var(--space-lg)",
            fontSize: "var(--text-small)",
          }}
        >
          Continue with <span className="mono">{maskedEmail(invitation.email)}</span>{" "}
          to activate {invitation.tenantName}.
        </p>
        <SignInForm
          mode="registration"
          nextPath={`/activate/${token}`}
        />
      </>
    );
  }

  if (
    !user.email ||
    user.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()
  ) {
    return (
      <Unavailable message="You are signed in with a different email address. Sign out and use the invited address." />
    );
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
        Activate {invitation.tenantName}
      </h1>
      <p
        className="text-secondary"
        style={{
          marginBottom: "var(--space-lg)",
          fontSize: "var(--text-small)",
        }}
      >
        The workspace is prepared and waiting for its verified owner.
      </p>
      <ActivationForm
        token={token}
        tenantName={invitation.tenantName}
        tenantSlug={invitation.tenantSlug}
        apexSuffix={activeApex()}
        displayName={invitation.contactName ?? user.email}
      />
    </>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <>
      <p className="eyebrow">Activation unavailable</p>
      <h1
        style={{
          fontSize: "var(--text-h1)",
          margin: "var(--space-xs) 0 var(--space-sm)",
        }}
      >
        This workspace cannot be activated
      </h1>
      <p className="text-secondary">{message}</p>
      <Link
        href="/sign-in"
        className="btn btn--secondary btn--block"
        style={{ marginTop: "var(--space-lg)" }}
      >
        Return to sign in
      </Link>
    </>
  );
}
