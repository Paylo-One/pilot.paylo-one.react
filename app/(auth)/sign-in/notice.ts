/**
 * app/(auth)/sign-in/notice.ts
 *
 * The callbacks (/auth/confirm, OAuth, tenant guards) redirect to /sign-in
 * with a `?error=` code when something interrupts a sign-in; `noticeFor()`
 * turns those into calm, non-technical guidance instead of leaking raw
 * provider messages. Extracted from page.tsx so it can be unit-tested.
 */

export type Notice = { tone: "info" | "warn"; message: string };

/** Translate the redirect codes (and raw provider messages) into human copy. */
export function noticeFor(params: {
  error?: string;
  existing?: string;
}): Notice | null {
  if (params.existing) {
    return {
      tone: "info",
      message: "You already have an account. Sign in below to open your workspace.",
    };
  }

  const raw = params.error;
  if (!raw) return null;

  switch (raw) {
    case "not_a_member":
      return {
        tone: "warn",
        message:
          "Your account isn't a member of that workspace. Sign in to your own workspace, or request access if you need an invitation.",
      };
    case "oauth_state":
      return {
        tone: "warn",
        message: "That sign-in couldn't be verified. Please start again.",
      };
    case "missing_code":
    case "missing_token":
      return {
        tone: "warn",
        message: "That sign-in link was incomplete. Request a fresh one below.",
      };
    default:
      break;
  }

  const lower = raw.toLowerCase();
  if (lower.includes("expired") || lower.includes("invalid")) {
    return {
      tone: "warn",
      message:
        "That sign-in link has expired. Links are single-use — request a fresh one below.",
    };
  }
  return {
    tone: "warn",
    message: "Something interrupted that sign-in. Please try again below.",
  };
}
