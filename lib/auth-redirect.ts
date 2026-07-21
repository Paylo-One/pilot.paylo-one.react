export function safeNextPath(nextPath: string): string {
  if (!nextPath.startsWith("/")) return "/onboarding";

  // Parse against a fixed dummy origin instead of relying on string prefixes.
  // URL parsers treat backslashes as slashes, so values such as `/\\evil.test`
  // can otherwise become network-path references in some clients.
  const base = "https://paylo.invalid";
  const destination = new URL(nextPath, base);
  if (destination.origin !== base) return "/onboarding";
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

/**
 * Build the `emailRedirectTo` for a magic link.
 *
 * `referralCode`, when present (registration), is folded into the `next` path as
 * a query param. It then rides through /auth/confirm — which forwards `next`
 * verbatim to its redirect — so onboarding can recover the referral even if the
 * apex `paylo_ref` cookie did not survive the email round-trip (different cookie
 * jar, in-app webview, privacy eviction). The code is public (it is the shared
 * /join link) and is re-validated server-side at onboarding, so carrying it in
 * the URL is safe.
 */
export function magicLinkRedirectUrl(
  origin: string,
  nextPath: string,
  referralCode?: string,
): string {
  let next = safeNextPath(nextPath);
  if (referralCode) {
    next += `${next.includes("?") ? "&" : "?"}ref=${encodeURIComponent(referralCode)}`;
  }
  return `${origin}/auth/confirm?next=${encodeURIComponent(next)}`;
}
