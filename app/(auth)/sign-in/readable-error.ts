/**
 * app/(auth)/sign-in/readable-error.ts
 *
 * Pure error-copy mapping for the sign-in form. Extracted from
 * sign-in-form.tsx so it can be unit-tested without a DOM.
 */

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Maps a raw auth error to calm, human copy. Returns `null` when the failure
 * should be swallowed into the neutral "link sent" state — for existing-user
 * sign-in we never confirm or deny whether an email has a workspace, so an
 * unknown address looks identical to a known one (no account enumeration).
 */
export function readableError(
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
