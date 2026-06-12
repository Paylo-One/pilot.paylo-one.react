/**
 * app/(auth)/enroll-passkey/page.tsx
 *
 * Passkey enrolment ceremony on the reserved, tenant-neutral `app.` host.
 *
 * WebAuthn origins are exact-match on the Auth server (no wildcards, max 5),
 * so ceremonies cannot run on arbitrary tenant hosts `<slug>.paylo.one`.
 * Sign-in already lives on the app host; this page gives enrolment the same
 * fixed origin. Tenant Settings hands off here with ?return_to=<settings url>
 * and the result travels back as query params, where the tenant host records
 * the audit trail (tenant context never exists on this host).
 *
 * The session cookie is apex-scoped, so the signed-in user from the tenant
 * host is signed in here too.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSignedInUser } from "@/modules/identity-tenant/server";
import { activeApex } from "@/lib/config";
import { resolveHost } from "@/lib/tenant/host";
import { EnrollPasskeyForm } from "./enroll-passkey-form";

export const metadata: Metadata = {
  title: "Add a passkey · Paylo.one",
  robots: { index: false, follow: false },
};

/**
 * Only ever send the user back to a host under our apex (open-redirect guard).
 * Falls back to onboarding, which forwards to the user's workspace.
 */
function safeReturnTo(raw: string | undefined): string {
  if (!raw) return "/onboarding";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "/onboarding";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "/onboarding";
  const decision = resolveHost(url.host, activeApex());
  return decision.kind === "invalid" ? "/onboarding" : url.toString();
}

export default async function EnrollPasskeyPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string; label?: string }>;
}) {
  const user = await getSignedInUser();
  if (!user) redirect("/sign-in");

  const params = await searchParams;
  const returnTo = safeReturnTo(params.return_to);

  return (
    <>
      <p className="eyebrow">Security</p>
      <h1 style={{ fontSize: "var(--text-h1)", margin: "var(--space-xs) 0 var(--space-sm)" }}>
        Add a passkey
      </h1>
      <p
        className="text-secondary"
        style={{ marginBottom: "var(--space-lg)", fontSize: "var(--text-small)" }}
      >
        Passkeys are registered here on the neutral app host so one passkey
        works across every workspace under {activeApex()}. Your browser will
        prompt for biometrics, a PIN, or a security key.
      </p>

      <EnrollPasskeyForm returnTo={returnTo} initialLabel={params.label ?? ""} />
    </>
  );
}
