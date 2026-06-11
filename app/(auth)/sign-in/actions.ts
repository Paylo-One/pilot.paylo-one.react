"use server";

/**
 * Server actions for passkey sign-in (authentication-architecture.md §5,
 * ADR-022). The WebAuthn ceremony runs in the browser; challenge issuance,
 * assertion verification, and session minting all happen here. The expected
 * origin comes from the request Host, which proxy.ts has already validated
 * against the apex allowlist — never from a client-supplied value.
 */

import { headers } from "next/headers";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import {
  beginPasskeyAssertion,
  completePasskeyAssertion,
  mintSessionForUser,
  type PasskeyAssertionStart,
} from "@/modules/authentication/server";
import { findPrimaryTenantSlug } from "@/modules/identity-tenant/server";
import { appHostBaseUrl, isDev, tenantBaseUrl } from "@/lib/config";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";

/** Issue an assertion challenge (usernameless — no account input needed). */
export async function beginPasskeyLoginAction(): Promise<PasskeyAssertionStart> {
  return beginPasskeyAssertion();
}

export interface PasskeyLoginResult {
  ok: boolean;
  error: string | null;
  /** Absolute URL to continue to after a successful sign-in. */
  redirectTo?: string;
}

/** Verify the assertion, mint the Supabase session, and audit the login. */
export async function completePasskeyLoginAction(input: {
  token: string;
  response: AuthenticationResponseJSON;
}): Promise<PasskeyLoginResult> {
  const h = await headers();
  const host = h.get("host") ?? "";
  const origin = isDev() ? `http://${host}` : `https://${host}`;

  const assertion = await completePasskeyAssertion({
    token: input.token,
    response: input.response,
    origin,
  });
  if (!assertion.ok || !assertion.userId) {
    return { ok: false, error: assertion.error ?? "login_failed" };
  }

  const minted = await mintSessionForUser(assertion.userId);
  if (!minted.ok) {
    return { ok: false, error: minted.error ?? "session_mint_failed" };
  }

  // Audit into the user's primary tenant: login precedes tenant resolution, so
  // there is no request tenant context yet.
  const secret = createSupabaseSecretClient();
  const { data: membership } = await secret
    .from("tenant_users")
    .select("tenant_id")
    .eq("user_id", assertion.userId)
    .limit(1)
    .maybeSingle();
  if (membership?.tenant_id) {
    await secret.from("audit_events").insert({
      tenant_id: membership.tenant_id,
      user_id: assertion.userId,
      action: "auth.passkey.login",
      metadata: { method: "passkey" },
    });
  }

  const slug = await findPrimaryTenantSlug(assertion.userId);
  return {
    ok: true,
    error: null,
    redirectTo: slug ? tenantBaseUrl(slug) : `${appHostBaseUrl()}/onboarding`,
  };
}
