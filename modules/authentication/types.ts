/**
 * modules/authentication/types.ts
 *
 * Passkey/WebAuthn-shaped type contracts for Paylo.one's passkey-first
 * authentication. Governance:
 *   - governance/docs/architecture/authentication-architecture.md
 *     (§4 registration, §5 login, §6 multi-device, §7 recovery)
 *   - governance/docs/services/identity-and-tenant.md (passkey-first auth,
 *     credential & device management, account recovery, data objects)
 *
 * These are SHAPES ONLY. There is NO real WebAuthn here: no `navigator`
 * credentials calls, no attestation/assertion crypto, no Supabase session.
 * Every runtime path that would touch a real authenticator throws
 * `NotImplementedError` (see index.ts).
 *
 * Security contract mirrored from governance:
 *   - The relying party id (RP ID) is the registrable domain `paylo.one` so a
 *     single passkey works across tenant subdomains (`<slug>.paylo.one`).
 *   - We store ONLY public keys (never a shared secret), verify attestation on
 *     registration, and verify the signature + signature counter on assertion.
 */

/**
 * WebAuthn authenticator transports. `hybrid` covers cross-device sign-in
 * (scan a QR with a phone holding the passkey) — authentication-architecture.md §5.
 */
export type AuthenticatorTransport =
  | "usb"
  | "nfc"
  | "ble"
  | "internal"
  | "hybrid";

/**
 * Whether the credential is a platform authenticator (OS keychain, may sync via
 * iCloud Keychain / Google Password Manager) or a roaming/cross-platform key
 * (FIDO2 security key) — authentication-architecture.md §6.
 */
export type CredentialDeviceType = "platform" | "cross-platform";

/**
 * A stored passkey. Maps to `passkey_credential` (identity-and-tenant.md
 * "Main data objects"): user-scoped, public key only, with a label, transports,
 * and a signature counter for clone detection.
 */
export interface PasskeyCredential {
  /** Internal row id. */
  readonly id: string;
  /** Owning Supabase auth user id (credentials authenticate a USER, not a tenant). */
  readonly userId: string;
  /** WebAuthn credential id (base64url). */
  readonly credentialId: string;
  /** Stored public key (COSE/base64url). NEVER a shared secret. */
  readonly publicKey: string;
  /** Transports advertised by the authenticator. */
  readonly transports: readonly AuthenticatorTransport[];
  /** User-facing label for device-management UI (e.g. "MacBook", "YubiKey"). */
  readonly label: string;
  /** Platform (syncable) vs cross-platform (roaming) authenticator. */
  readonly deviceType: CredentialDeviceType;
  /** Signature counter; a non-increasing counter signals a possible clone. */
  readonly signCount: number;
  readonly createdAt: string;
  readonly lastUsedAt?: string;
}

/**
 * Server-issued WebAuthn registration challenge (authentication-architecture.md
 * §4). Bound to a verified identity (the invite) before a passkey is created.
 */
export interface PasskeyRegistrationChallenge {
  /** User the credential will be enrolled for. */
  readonly userId: string;
  /** RP ID = registrable domain (`paylo.one`) so one passkey spans subdomains. */
  readonly rpId: string;
  /** Random base64url challenge the authenticator must sign. */
  readonly challenge: string;
  /** Challenge expiry (challenges are single-use + time-boxed). */
  readonly expiresAt: string;
  /**
   * Existing credential ids to exclude, so a device can't silently
   * re-register an already-enrolled passkey.
   */
  readonly excludeCredentialIds: readonly string[];
}

/**
 * The attestation an authenticator returns after creating a passkey. The server
 * verifies this and persists a {@link PasskeyCredential} (public key + id).
 */
export interface PasskeyAttestation {
  readonly credentialId: string;
  readonly publicKey: string;
  readonly transports: readonly AuthenticatorTransport[];
  /** base64url clientDataJSON returned by the authenticator. */
  readonly clientDataJSON: string;
  /** base64url attestationObject returned by the authenticator. */
  readonly attestationObject: string;
}

/** Outcome of a verified registration: the newly stored credential. */
export interface PasskeyRegistrationResult {
  readonly credential: PasskeyCredential;
  /**
   * Whether the operator should be prompted to enrol a SECOND credential or
   * recovery codes (governance encourages >=2 credentials at enrolment to
   * pre-empt device loss — authentication-architecture.md §4, §7).
   */
  readonly recommendSecondFactor: boolean;
}

/**
 * Server-issued WebAuthn assertion (login) challenge
 * (authentication-architecture.md §5).
 */
export interface PasskeyAssertionChallenge {
  readonly rpId: string;
  readonly challenge: string;
  readonly expiresAt: string;
  /**
   * Optional allow-list of credential ids. Empty means a usernameless /
   * discoverable-credential flow.
   */
  readonly allowCredentialIds: readonly string[];
}

/** The assertion an authenticator returns after signing an assertion challenge. */
export interface PasskeyAssertion {
  readonly credentialId: string;
  readonly clientDataJSON: string;
  readonly authenticatorData: string;
  readonly signature: string;
  /** Optional user handle for discoverable credentials. */
  readonly userHandle?: string;
}

/**
 * Outcome of a verified assertion: the authenticated user + the advanced
 * signature counter the server must persist (clone-detection input).
 */
export interface PasskeyAssertionResult {
  readonly userId: string;
  readonly credentialId: string;
  /** New signature counter; must be strictly greater than the stored value. */
  readonly newSignCount: number;
}

/**
 * A one-time-shown batch of recovery codes (authentication-architecture.md §7).
 * Codes are single-use and stored HASHED; the plaintext exists only at
 * generation time and is never persisted.
 */
export interface RecoveryCodeBatch {
  readonly userId: string;
  /** Plaintext codes, shown ONCE to the operator at generation. */
  readonly codes: readonly string[];
  readonly generatedAt: string;
  readonly count: number;
}

/** Result of consuming a recovery code (consumed on use; regenerate after). */
export interface RecoveryCodeConsumption {
  readonly userId: string;
  /** Codes remaining in the active batch. */
  readonly remaining: number;
}

/**
 * The deliberate, limited verified-email fallback (authentication-architecture.md
 * §7, §10). A time-boxed, single-use link to a verified address — rate-limited,
 * notified, and audited. It is the weakest link and is treated as such.
 */
export interface EmailRecoveryChallenge {
  readonly userId: string;
  /** The verified email the single-use link is sent to. */
  readonly email: string;
  /** Single-use token embedded in the recovery link. */
  readonly token: string;
  /** Short expiry — the fallback is time-boxed. */
  readonly expiresAt: string;
}

/**
 * The ONLY thing a consumed email-recovery token may produce: a registration
 * challenge to enrol a NEW passkey. It must NEVER bypass passkeys for normal
 * login (authentication-architecture.md §7: "used only to enrol a new passkey").
 */
export interface EmailRecoveryEnrolment {
  readonly registrationChallenge: PasskeyRegistrationChallenge;
}

/**
 * Passkey-ready interim methods. The MVP MAY ship one of these (without changing
 * tenant binding or RLS) and enable passkeys as primary later
 * (authentication-architecture.md §11, ADR-022).
 */
export type InterimAuthMethod = "magic_link" | "oauth";

/** How the current session was established. */
export type AuthMethod = "passkey" | InterimAuthMethod;

/**
 * The authenticated session as far as authentication is concerned: WHO the user
 * is. The TENANT is resolved separately on every request (see session-binding.ts
 * and authentication-architecture.md §8 — anti session-tenant-mismatch).
 */
export interface AuthenticatedSession {
  /** Supabase auth user id. */
  readonly userId: string;
  /** Opaque Supabase session id. */
  readonly sessionId: string;
  readonly issuedAt: string;
  /** The method used to establish this session. */
  readonly method: AuthMethod;
}
