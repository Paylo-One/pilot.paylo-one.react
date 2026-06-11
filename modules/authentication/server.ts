import "server-only";

/**
 * modules/authentication/server.ts
 *
 * Concrete WebAuthn passkey registration + credential management against
 * Supabase (authentication-architecture.md §4–6, ADR-022). This implements the
 * registration half of the documented AuthenticationService contract; passkey
 * LOGIN (assertion) stays on the interim magic link until session minting is
 * wired (§11 "passkey-ready" posture — swapping login later does not change
 * tenant binding or RLS).
 *
 * Security model:
 *   - RP ID = the registrable apex (activeApex()), so one passkey works across
 *     every <slug> subdomain.
 *   - The server-issued challenge is carried through the browser round-trip as
 *     an HMAC-signed, time-boxed token (same pattern as the OAuth state in
 *     source-connection/github.ts) — the client can neither mint nor reuse one.
 *   - Attestation is verified server-side; the credential row is written with
 *     the secret client. Reads/relabels/revocations use the USER client so RLS
 *     (passkey_credentials_self_*) is the enforcement, not app code.
 *   - Credentials authenticate a USER. The tenant where enrolment happened is
 *     recorded for provenance and the audit trail only.
 */

import { createHmac, timingSafeEqual } from "crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import type { TenantContext } from "@/modules/shared";
import {
  activeApex,
  appHostBaseUrl,
  supabaseSecretKey,
  tenantBaseUrl,
} from "@/lib/config";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Human-facing relying-party name shown by authenticator prompts. */
const RP_NAME = "Paylo.one Management OS";

/** Lifetime of a registration challenge (seconds). */
export const PASSKEY_CHALLENGE_TTL_SECONDS = 300;

/** A stored credential, shaped for the device-management UI. */
export interface PasskeyView {
  readonly id: string;
  readonly label: string | null;
  /** "multi_device" = synced (e.g. iCloud Keychain); "single_device" = bound. */
  readonly deviceType: "single_device" | "multi_device";
  readonly backedUp: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

// --- Signed challenge token ---------------------------------------------------

interface ChallengeTokenPayload {
  /** Which ceremony the token authorises — prevents cross-ceremony replay. */
  readonly scope: "register" | "assert";
  /** Bound user for registration; null for usernameless assertion. */
  readonly userId: string | null;
  readonly challenge: string;
  /** Expiry (epoch seconds). */
  readonly exp: number;
}

function sign(value: string): string {
  return createHmac("sha256", supabaseSecretKey()).update(value).digest("base64url");
}

function createChallengeToken(
  scope: ChallengeTokenPayload["scope"],
  userId: string | null,
  challenge: string,
): string {
  const payload: ChallengeTokenPayload = {
    scope,
    userId,
    challenge,
    exp: Math.floor(Date.now() / 1000) + PASSKEY_CHALLENGE_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function verifyChallengeToken(
  token: string,
  scope: ChallengeTokenPayload["scope"],
  userId: string | null,
): ChallengeTokenPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = Buffer.from(sign(body));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }

  let payload: ChallengeTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload.scope !== scope) return null;
  if (payload.userId !== userId) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// --- Registration ---------------------------------------------------------------

export interface PasskeyRegistrationStart {
  readonly optionsJSON: PublicKeyCredentialCreationOptionsJSON;
  /** Signed challenge token; must be returned verbatim to complete. */
  readonly token: string;
}

/**
 * Issue a WebAuthn registration challenge for the signed-in user. Existing
 * credentials are excluded so an authenticator refuses double-enrolment.
 */
export async function beginPasskeyRegistration(user: {
  userId: string;
  email: string | null;
}): Promise<PasskeyRegistrationStart> {
  const secret = createSupabaseSecretClient();
  const { data: existing, error } = await secret
    .from("passkey_credentials")
    .select("credential_id, transports")
    .eq("user_id", user.userId);
  if (error) throw new Error(error.message);

  const optionsJSON = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: activeApex(),
    userName: user.email ?? user.userId,
    userID: isoUint8Array.fromUTF8String(user.userId),
    attestationType: "none",
    excludeCredentials: (existing ?? []).map((c) => ({
      id: c.credential_id as string,
      transports: (c.transports as PasskeyTransports) ?? undefined,
    })),
    authenticatorSelection: {
      // Discoverable credential so usernameless login is possible later (§5).
      residentKey: "required",
      userVerification: "preferred",
    },
  });

  return {
    optionsJSON,
    token: createChallengeToken("register", user.userId, optionsJSON.challenge),
  };
}

type PasskeyTransports = NonNullable<
  RegistrationResponseJSON["response"]["transports"]
>;

export interface PasskeyRegistrationOutcome {
  readonly ok: boolean;
  readonly error?: string;
  readonly credentialRowId?: string;
}

/**
 * Verify the authenticator's attestation and persist the credential. The label
 * is operator-facing only; the tenant in `ctx` is recorded as provenance.
 */
export async function completePasskeyRegistration(input: {
  ctx: TenantContext;
  token: string;
  response: RegistrationResponseJSON;
  label?: string | null;
}): Promise<PasskeyRegistrationOutcome> {
  const payload = verifyChallengeToken(input.token, "register", input.ctx.userId);
  if (!payload) return { ok: false, error: "challenge_expired" };

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: payload.challenge,
      // Enrolment happens on the tenant workspace; the neutral app host is
      // allowed too (future invite-flow enrolment, §4).
      expectedOrigin: [tenantBaseUrl(input.ctx.tenantSlug), appHostBaseUrl()],
      expectedRPID: activeApex(),
      requireUserVerification: false,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "verification_failed";
    return { ok: false, error: message };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, error: "attestation_not_verified" };
  }

  const info = verification.registrationInfo;
  const label = input.label?.trim().slice(0, 60) || null;

  const secret = createSupabaseSecretClient();
  const { data: row, error } = await secret
    .from("passkey_credentials")
    .insert({
      user_id: input.ctx.userId,
      credential_id: info.credential.id,
      public_key: isoBase64URL.fromBuffer(info.credential.publicKey),
      transports: info.credential.transports ?? input.response.response.transports ?? [],
      device_type: info.credentialDeviceType === "multiDevice" ? "multi_device" : "single_device",
      backed_up: info.credentialBackedUp,
      label,
      sign_count: info.credential.counter,
      registered_tenant_id: input.ctx.tenantId,
    })
    .select("id")
    .single();

  if (error || !row) {
    // 23505 = unique_violation: this authenticator is already enrolled.
    const duplicate = error?.code === "23505";
    return { ok: false, error: duplicate ? "already_registered" : (error?.message ?? "store_failed") };
  }

  return { ok: true, credentialRowId: row.id as string };
}

// --- Assertion (login) ----------------------------------------------------------

export interface PasskeyAssertionStart {
  readonly optionsJSON: PublicKeyCredentialRequestOptionsJSON;
  /** Signed challenge token; must be returned verbatim to complete. */
  readonly token: string;
}

/**
 * Issue a WebAuthn assertion challenge. Usernameless: credentials are enrolled
 * as discoverable (residentKey: required), so no allowCredentials list is
 * needed — the authenticator offers the user's passkeys for this RP itself.
 */
export async function beginPasskeyAssertion(): Promise<PasskeyAssertionStart> {
  const optionsJSON = await generateAuthenticationOptions({
    rpID: activeApex(),
    userVerification: "preferred",
  });
  return {
    optionsJSON,
    token: createChallengeToken("assert", null, optionsJSON.challenge),
  };
}

export interface PasskeyAssertionOutcome {
  readonly ok: boolean;
  readonly error?: string;
  /** The verified owner of the asserted credential. */
  readonly userId?: string;
}

/**
 * Verify a WebAuthn assertion against the stored credential: signature,
 * challenge, origin, RP ID, and signature counter. On success the counter and
 * last_used_at are persisted. Establishing a session is the caller's job
 * (mintSessionForUser) — verification and session creation stay separable.
 */
export async function completePasskeyAssertion(input: {
  token: string;
  response: AuthenticationResponseJSON;
  /** The proxy-validated origin the ceremony ran on. */
  origin: string;
}): Promise<PasskeyAssertionOutcome> {
  const payload = verifyChallengeToken(input.token, "assert", null);
  if (!payload) return { ok: false, error: "challenge_expired" };

  const secret = createSupabaseSecretClient();
  const { data: cred, error } = await secret
    .from("passkey_credentials")
    .select("id, user_id, credential_id, public_key, transports, sign_count")
    .eq("credential_id", input.response.id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!cred) return { ok: false, error: "unknown_credential" };

  // The discoverable credential's user handle was set to the Supabase user id
  // at enrolment; a mismatch with the stored owner is a hard failure.
  const userHandle = input.response.response.userHandle;
  if (
    userHandle &&
    Buffer.from(userHandle, "base64url").toString("utf8") !== (cred.user_id as string)
  ) {
    return { ok: false, error: "user_mismatch" };
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: payload.challenge,
      expectedOrigin: input.origin,
      expectedRPID: activeApex(),
      credential: {
        id: cred.credential_id as string,
        publicKey: isoBase64URL.toBuffer(cred.public_key as string),
        counter: Number(cred.sign_count),
        transports: (cred.transports as PasskeyTransports | null) ?? undefined,
      },
      requireUserVerification: false,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "verification_failed";
    return { ok: false, error: message };
  }

  if (!verification.verified) {
    return { ok: false, error: "assertion_not_verified" };
  }

  await secret
    .from("passkey_credentials")
    .update({
      sign_count: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", cred.id);

  return { ok: true, userId: cred.user_id as string };
}

/**
 * Establish a Supabase session for a passkey-verified user. Supabase Auth has
 * no native WebAuthn sign-in, so the session is minted through the admin API:
 * generate a magic-link token_hash for the user's email (generateLink sends no
 * email) and verify it immediately with the cookie-bound server client. The
 * token never leaves the server and is single-use. Trade-off vs
 * signInWithIdToken: no external OIDC provider needed, and the resulting
 * session is indistinguishable from a magic-link session for tenant binding
 * and RLS — exactly the §11 "swap login without changing the contract" goal.
 */
export async function mintSessionForUser(
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const secret = createSupabaseSecretClient();

  const { data: userData, error: userErr } = await secret.auth.admin.getUserById(userId);
  const email = userData?.user?.email;
  if (userErr || !email) {
    return { ok: false, error: userErr?.message ?? "user_not_found" };
  }

  const { data: link, error: linkErr } = await secret.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    return { ok: false, error: linkErr?.message ?? "session_mint_failed" };
  }

  const supabase = await createSupabaseServerClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (verifyErr) return { ok: false, error: verifyErr.message };

  return { ok: true };
}

// --- Credential management (RLS-enforced: user's own rows only) ---------------

/** List the signed-in user's enrolled passkeys (newest first). */
export async function listPasskeys(): Promise<PasskeyView[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("passkey_credentials")
    .select("id, label, device_type, backed_up, created_at, last_used_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    label: (r.label as string | null) ?? null,
    deviceType: r.device_type as PasskeyView["deviceType"],
    backedUp: r.backed_up as boolean,
    createdAt: r.created_at as string,
    lastUsedAt: (r.last_used_at as string | null) ?? null,
  }));
}

/** Relabel one of the user's own passkeys (RLS scopes the update). */
export async function renamePasskey(credentialRowId: string, label: string): Promise<void> {
  const trimmed = label.trim().slice(0, 60);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("passkey_credentials")
    .update({ label: trimmed.length > 0 ? trimmed : null })
    .eq("id", credentialRowId);
  if (error) throw new Error(error.message);
}

/** Revoke (delete) one of the user's own passkeys (RLS scopes the delete). */
export async function revokePasskey(credentialRowId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("passkey_credentials")
    .delete()
    .eq("id", credentialRowId);
  if (error) throw new Error(error.message);
}
