"use client";

/**
 * Sign-in form: passkey-first (native Supabase WebAuthn) with the magic link as
 * the fallback. Both establish the same apex-scoped session cookie, so tenant
 * binding and RLS are identical regardless of method.
 *
 *   - signInWithPasskey() runs the full discoverable-credential ceremony
 *     (challenge → navigator.credentials.get() → verify → session) entirely on
 *     the Auth server; the user picks their account from the authenticator UI,
 *     so no email is needed up front.
 *   - signInWithOtp() emails a magic link back to /auth/confirm. Existing-user
 *     sign-in disables account creation; the referral-only registration page
 *     opts into it after server-side validation.
 *
 * After either succeeds we send the user to /onboarding on the app host, which
 * forwards to their workspace (or claims a subdomain for a brand-new user).
 *
 * The auth calls below are unchanged from the original implementation; the work
 * here is state, copy, accessibility, and resilient error handling.
 */

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { magicLinkRedirectUrl, safeNextPath } from "@/lib/auth-redirect";

/** WebAuthn support never changes within a page lifetime — no updates to push. */
function subscribeNever(): () => void {
  return () => {};
}

function passkeySupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_SECONDS = 30;

type Status = "idle" | "sending" | "sent" | "redirecting";

/**
 * Maps a raw auth error to calm, human copy. Returns `null` when the failure
 * should be swallowed into the neutral "link sent" state — for existing-user
 * sign-in we never confirm or deny whether an email has a workspace, so an
 * unknown address looks identical to a known one (no account enumeration).
 */
function readableError(
  err: unknown,
  mode: "sign-in" | "registration",
  channel: "passkey" | "link",
): string | null {
  const name = err instanceof Error ? err.name : "";
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const message = raw.toLowerCase();

  if (channel === "passkey") {
    if (name === "NotAllowedError" || message.includes("cancel")) {
      return "Passkey sign-in was cancelled. Try again, or use a one-time email link below.";
    }
    if (
      name === "InvalidStateError" ||
      message.includes("no passkey") ||
      message.includes("not found") ||
      message.includes("no credentials")
    ) {
      return "No passkey is registered on this device yet. Use a one-time email link, then add a passkey under Settings → Security.";
    }
    return "We couldn't complete passkey sign-in. Try again, or use a one-time email link below.";
  }

  // Existing-user sign-in for an address with no workspace: stay neutral.
  if (
    mode === "sign-in" &&
    (message.includes("signups not allowed") ||
      message.includes("signup is disabled") ||
      message.includes("otp_disabled") ||
      message.includes("user not found"))
  ) {
    return null;
  }

  if (message.includes("rate") || message.includes("too many") || message.includes("429")) {
    return "Too many requests just now. Wait a minute, then try again.";
  }
  if (
    message.includes("network") ||
    message.includes("failed to fetch") ||
    message.includes("load failed") ||
    message.includes("offline")
  ) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  if (message.includes("invalid") && message.includes("email")) {
    return "That email doesn't look right. Check it and try again.";
  }
  return mode === "registration"
    ? "We couldn't send your verification link just now. Please try again."
    : "We couldn't send your sign-in link just now. Please try again.";
}

export function SignInForm({
  mode = "sign-in",
  nextPath = "/onboarding",
  referralCode,
}: {
  mode?: "sign-in" | "registration";
  nextPath?: string;
  /**
   * Registration only: the validated referral code, threaded into the magic
   * link so onboarding can recover it if the `paylo_ref` cookie is lost across
   * the email round-trip. Ignored for ordinary sign-in.
   */
  referralCode?: string;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sentEmail, setSentEmail] = useState("");

  const errorId = useId();
  const noteId = useId();

  // null on the server snapshot so SSR and hydration agree.
  const supported = useSyncExternalStore(subscribeNever, passkeySupported, () => null);
  const showPasskey = mode === "sign-in" && supported !== false;

  // Resend cooldown tick.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => {
      setCooldown((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  async function signInWithPasskey() {
    setError(null);
    setPasskeyBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPasskey();
      if (error) throw error;
      setStatus("redirecting");
      window.location.assign(safeNextPath(nextPath));
    } catch (err) {
      setError(readableError(err, mode, "passkey"));
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function sendLink() {
    setError(null);
    setStatus("sending");
    try {
      const supabase = createSupabaseBrowserClient();
      const emailRedirectTo = magicLinkRedirectUrl(
        window.location.origin,
        nextPath,
        mode === "registration" ? referralCode : undefined,
      );
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo,
          shouldCreateUser: mode === "registration",
        },
      });
      if (error) throw error;
      setSentEmail(email);
      setStatus("sent");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      const friendly = readableError(err, mode, "link");
      if (friendly === null) {
        // Neutral: an unknown address looks the same as a known one.
        setSentEmail(email);
        setStatus("sent");
        setCooldown(RESEND_COOLDOWN_SECONDS);
        return;
      }
      setStatus("idle");
      setError(friendly);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!EMAIL_PATTERN.test(email)) {
      setError("Enter a valid email address to continue.");
      return;
    }
    void sendLink();
  }

  function resend() {
    if (cooldown > 0 || status === "sending") return;
    void sendLink();
  }

  function useDifferentEmail() {
    setStatus("idle");
    setError(null);
    setEmail("");
  }

  if (status === "sent") {
    const target = sentEmail;
    return (
      <div className="auth-form auth-sent" role="status" aria-live="polite">
        <span className="auth-sent__icon" aria-hidden="true">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
        </span>
        <h2 className="auth-sent__title">Check your email</h2>
        <p className="auth-sent__body">
          We sent a single-use sign-in link to{" "}
          <strong className="auth-sent__email">{target}</strong>. Open it on this
          device to continue. The link expires shortly and works only once.
        </p>
        <div className="auth-sent__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={resend}
            disabled={cooldown > 0 || (status as Status) === "sending"}
          >
            {cooldown > 0 ? `Send again in ${cooldown}s` : "Send the link again"}
          </button>
          <button type="button" className="btn btn--ghost" onClick={useDifferentEmail}>
            Use a different email
          </button>
        </div>
        <p className="auth-sent__hint">
          Nothing yet? Check spam, or confirm{" "}
          <span className="mono">{target}</span> is the address on your account.
        </p>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={onSubmit} noValidate>
      {showPasskey ? (
        <>
          <button
            type="button"
            className="btn btn--primary btn--block auth-btn"
            disabled={passkeyBusy || supported !== true || status === "redirecting"}
            onClick={signInWithPasskey}
          >
            {passkeyBusy ? (
              <>
                <span className="auth-spinner" aria-hidden="true" />
                Waiting for your passkey…
              </>
            ) : status === "redirecting" ? (
              "Opening your workspace…"
            ) : (
              <>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Use your passkey
              </>
            )}
          </button>
          <div className="auth-divider" role="separator">
            <span>or</span>
          </div>
        </>
      ) : null}

      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="email" className="field__label">
          {mode === "registration" ? "Your email" : "Work email"}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          required
          autoComplete="email webauthn"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
          placeholder="you@company.com"
          className="input"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${noteId}${error ? ` ${errorId}` : ""}`}
        />
      </div>

      <button
        type="submit"
        disabled={status === "sending" || status === "redirecting"}
        className={`btn btn--block auth-btn ${showPasskey ? "btn--secondary" : "btn--primary"}`}
        style={{ marginTop: "var(--space-md)" }}
      >
        {status === "sending" ? (
          <>
            <span className="auth-spinner" aria-hidden="true" />
            Sending your link…
          </>
        ) : mode === "registration" ? (
          "Send my verification link"
        ) : (
          "Email me a sign-in link"
        )}
      </button>

      <p id={noteId} className="auth-form__note">
        {mode === "registration"
          ? "We'll send a one-time link to confirm it's you — no password to set."
          : "No password required. We'll send a one-time link that signs you in."}
      </p>

      {error ? (
        <p id={errorId} className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
