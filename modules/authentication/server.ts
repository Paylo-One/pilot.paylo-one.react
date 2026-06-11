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
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type PublicKeyCredentialCreationOptionsJSON,
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
  readonly userId: string;
  readonly challenge: string;
  /** Expiry (epoch seconds). */
  readonly exp: number;
}

function sign(value: string): string {
  return createHmac("sha256", supabaseSecretKey()).update(value).digest("base64url");
}

function createChallengeToken(userId: string, challenge: string): string {
  const payload: ChallengeTokenPayload = {
    userId,
    challenge,
    exp: Math.floor(Date.now() / 1000) + PASSKEY_CHALLENGE_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function verifyChallengeToken(token: string, userId: string): ChallengeTokenPayload | null {
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
    token: createChallengeToken(user.userId, optionsJSON.challenge),
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
  const payload = verifyChallengeToken(input.token, input.ctx.userId);
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
