/**
 * modules/authentication — passkey-first (WebAuthn) authentication, multi-device
 * credential management, account recovery, and the session <-> tenant binding
 * contract. Owned conceptually by Identity & Tenant; this module exposes the
 * typed interfaces the rest of the app programs against.
 *
 * Governance:
 *   - governance/docs/architecture/authentication-architecture.md
 *   - governance/docs/services/identity-and-tenant.md
 *
 * Scaffold note: INTERFACES ONLY. There is NO real WebAuthn, no attestation /
 * assertion crypto, no Supabase Auth session, and no passkeys. Every execution
 * path throws `NotImplementedError` so "not built yet" is explicit and greppable.
 *
 * MVP note (authentication-architecture.md §11, ADR-022): the MVP MAY ship a
 * passkey-READY interim method (email magic link / OAuth) instead of passkeys as
 * primary. That choice does NOT change the session <-> tenant binding contract
 * (session-binding.ts) or RLS — only how the initial Supabase session is minted.
 */

import {
  NotImplementedError,
  type Result,
} from "@/modules/shared";
import type {
  EmailRecoveryChallenge,
  EmailRecoveryEnrolment,
  PasskeyAssertion,
  PasskeyAssertionChallenge,
  PasskeyAssertionResult,
  PasskeyAttestation,
  PasskeyCredential,
  PasskeyRegistrationChallenge,
  PasskeyRegistrationResult,
  RecoveryCodeBatch,
  RecoveryCodeConsumption,
} from "./types";

export * from "./types";
export * from "./session-binding";

/**
 * The passkey-first authentication service. Groups the WebAuthn registration and
 * assertion flows, multi-device credential management, recovery codes, and the
 * deliberate verified-email fallback.
 *
 * All methods return `Result` for expected/denied outcomes; the scaffold const
 * below throws `NotImplementedError` because none of these flows are built.
 */
export interface AuthenticationService {
  // --- Registration (passkey enrolment) — authentication-architecture.md §4 ---

  /**
   * Issue a WebAuthn registration challenge for an already-identity-verified
   * user (e.g. just accepted an invite). RP ID = registrable domain.
   */
  beginRegistration(userId: string): Promise<Result<PasskeyRegistrationChallenge>>;

  /**
   * Verify the authenticator's attestation against `challenge`, then persist the
   * resulting public-key credential under `label`.
   */
  completeRegistration(
    challenge: PasskeyRegistrationChallenge,
    attestation: PasskeyAttestation,
    label: string,
  ): Promise<Result<PasskeyRegistrationResult>>;

  // --- Login (passkey assertion) — authentication-architecture.md §5 ----------

  /** Issue a WebAuthn assertion (login) challenge. */
  beginAssertion(
    options?: { readonly allowCredentialIds?: readonly string[] },
  ): Promise<Result<PasskeyAssertionChallenge>>;

  /**
   * Verify the assertion signature against the stored public key and check the
   * signature counter; on success the caller mints a Supabase session.
   */
  completeAssertion(
    challenge: PasskeyAssertionChallenge,
    assertion: PasskeyAssertion,
  ): Promise<Result<PasskeyAssertionResult>>;

  // --- Multi-device credential management — authentication-architecture.md §6 -

  /** List the user's enrolled passkeys (for the device-management UI). */
  listCredentials(userId: string): Promise<Result<PasskeyCredential[]>>;

  /** Rename a credential's user-facing label. */
  labelCredential(
    userId: string,
    credentialId: string,
    label: string,
  ): Promise<Result<PasskeyCredential>>;

  /** Revoke (remove) a credential, e.g. a lost device. Audited + notified. */
  revokeCredential(
    userId: string,
    credentialId: string,
  ): Promise<Result<void>>;

  // --- Recovery — authentication-architecture.md §7 ---------------------------

  /**
   * Generate a fresh batch of single-use recovery codes (shown once, stored
   * hashed). Regenerate after any code is consumed.
   */
  generateRecoveryCodes(userId: string): Promise<Result<RecoveryCodeBatch>>;

  /** Consume one recovery code; consumed on use. */
  consumeRecoveryCode(
    userId: string,
    code: string,
  ): Promise<Result<RecoveryCodeConsumption>>;

  /**
   * Begin the deliberate, rate-limited, time-boxed verified-email fallback. A
   * single-use link is sent to the verified address.
   */
  beginEmailRecovery(email: string): Promise<Result<EmailRecoveryChallenge>>;

  /**
   * Consume an email-recovery token. The ONLY permitted outcome is a passkey
   * registration challenge — this path NEVER bypasses passkeys for normal login
   * (authentication-architecture.md §7).
   */
  completeEmailRecovery(token: string): Promise<Result<EmailRecoveryEnrolment>>;
}

/**
 * Scaffold service. Every method throws `NotImplementedError`. Identity & Tenant
 * supplies the real implementation (and the {@link TenantResolver} for
 * session-binding) at wiring time.
 */
export const authenticationService: AuthenticationService = {
  async beginRegistration() {
    throw new NotImplementedError("authentication.beginRegistration");
  },
  async completeRegistration() {
    throw new NotImplementedError("authentication.completeRegistration");
  },
  async beginAssertion() {
    throw new NotImplementedError("authentication.beginAssertion");
  },
  async completeAssertion() {
    throw new NotImplementedError("authentication.completeAssertion");
  },
  async listCredentials() {
    throw new NotImplementedError("authentication.listCredentials");
  },
  async labelCredential() {
    throw new NotImplementedError("authentication.labelCredential");
  },
  async revokeCredential() {
    throw new NotImplementedError("authentication.revokeCredential");
  },
  async generateRecoveryCodes() {
    throw new NotImplementedError("authentication.generateRecoveryCodes");
  },
  async consumeRecoveryCode() {
    throw new NotImplementedError("authentication.consumeRecoveryCode");
  },
  async beginEmailRecovery() {
    throw new NotImplementedError("authentication.beginEmailRecovery");
  },
  async completeEmailRecovery() {
    throw new NotImplementedError("authentication.completeEmailRecovery");
  },
};
