/**
 * /auth/confirm — completes magic-link sign-in via the SSR token_hash pattern.
 * The custom magic-link email links here (GET) with `token_hash` + `type`; we
 * verify the OTP server-side (sets the session cookie, apex-scoped) and redirect
 * to `next` (default /onboarding). Also accepts a PKCE `code` as a fallback.
 *
 * IMPORTANT — single-use tokens vs. email scanners:
 * Magic-link tokens are single-use. Corporate mail security (Microsoft 365 Safe
 * Links, Outlook/Gmail preview, antivirus) fetches links in inbound mail before
 * the human clicks. If we verified on the GET, that automated fetch would burn
 * the token and the real click would fail with "link expired / single-use".
 *
 * So the GET does NOT verify: it renders a tiny interstitial that POSTs the
 * token back to this same route. Link scanners issue GETs and don't run JS, so
 * they never consume the token; real browsers auto-submit the form on load (with
 * a visible button as a no-JS fallback). Verification happens only on the POST.
 * authentication-architecture.md §5.
 */

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { appHostBaseUrl, tenantBaseUrl } from "@/lib/config";
import { safeNextPath } from "@/lib/auth-redirect";
import { findPrimaryTenantSlug } from "@/modules/identity-tenant/server";

/** HTML-attribute escaping for values echoed into the interstitial form. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * GET = render the interstitial only. We never call verifyOtp here, so an
 * automated link-scanner fetch cannot consume the single-use token.
 */
export function GET(request: NextRequest): NextResponse {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next") ?? "/onboarding");

  // No credential at all → nothing to confirm; send back to sign-in.
  if (!((tokenHash && type) || code)) {
    return NextResponse.redirect(
      `${appHostBaseUrl()}/sign-in?error=missing_token`,
    );
  }

  const fields = [
    tokenHash ? `<input type="hidden" name="token_hash" value="${escapeHtml(tokenHash)}" />` : "",
    type ? `<input type="hidden" name="type" value="${escapeHtml(type)}" />` : "",
    code ? `<input type="hidden" name="code" value="${escapeHtml(code)}" />` : "",
    `<input type="hidden" name="next" value="${escapeHtml(next)}" />`,
  ].join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Signing you in · Paylo.one</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#f4f5f7; color:#16181d;
         font-family:'IBM Plex Sans',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; }
  .card { width:100%; max-width:380px; margin:24px; padding:40px; background:#fff;
          border:1px solid #e3e5ea; border-radius:8px; text-align:center; }
  .eyebrow { font-family:'IBM Plex Mono','SF Mono',Consolas,monospace; font-size:11px; font-weight:500;
             text-transform:uppercase; letter-spacing:0.08em; color:#878d98; margin:0 0 12px; }
  h1 { font-size:20px; font-weight:600; letter-spacing:-0.015em; margin:0 0 8px; }
  p { font-size:14px; line-height:1.6; color:#565d68; margin:0 0 24px; }
  .spinner { width:28px; height:28px; margin:0 auto 20px; border:3px solid #e3e5ea;
             border-top-color:#157a86; border-radius:50%; animation:spin .8s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation:none; } }
  button { display:inline-block; padding:13px 28px; font:inherit; font-size:15px; font-weight:600;
           color:#fff; background:#157a86; border:0; border-radius:6px; cursor:pointer; }
  button:hover { background:#11636d; }
  .hint { margin:16px 0 0; font-size:12px; color:#878d98; }
</style>
</head>
<body>
  <main class="card">
    <div class="spinner" aria-hidden="true"></div>
    <p class="eyebrow">Secure sign-in</p>
    <h1>Signing you in…</h1>
    <p>Confirming your single-use link. This only takes a moment.</p>
    <form id="confirm" method="POST" action="/auth/confirm">
      ${fields}
      <button type="submit">Continue to sign in</button>
    </form>
    <p class="hint">If nothing happens, tap the button above.</p>
  </main>
  <script>
    // Real browsers auto-submit immediately; link scanners (no JS) never do,
    // so they cannot consume the single-use token.
    document.getElementById('confirm').submit();
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Defence in depth: never let an intermediary cache the token-bearing page.
      "cache-control": "no-store, max-age=0",
    },
  });
}

/**
 * POST = the actual verification. Only reached by a real, JS-capable browser
 * submitting the interstitial form (or a deliberate button press).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const form = await request.formData();
  const tokenHash = (form.get("token_hash") as string | null) ?? null;
  const type = (form.get("type") as EmailOtpType | null) ?? null;
  const code = (form.get("code") as string | null) ?? null;
  const next = safeNextPath((form.get("next") as string | null) ?? "/onboarding");

  const supabase = await createSupabaseServerClient();

  let errorMessage: string | null = null;
  let userId: string | undefined;

  if (tokenHash && type) {
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    errorMessage = error?.message ?? null;
    userId = data.user?.id;
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    errorMessage = error?.message ?? null;
    userId = data.user?.id;
  } else {
    errorMessage = "missing_token";
  }

  // 303 → the browser follows every post-verify redirect as a GET (not a POST).
  if (errorMessage) {
    return NextResponse.redirect(
      `${appHostBaseUrl()}/sign-in?error=${encodeURIComponent(errorMessage)}`,
      { status: 303 },
    );
  }

  if (next.startsWith("/activate/")) {
    return NextResponse.redirect(`${appHostBaseUrl()}${next}`, { status: 303 });
  }

  // If the user already owns a workspace, skip onboarding and go straight to it.
  if (userId) {
    const slug = await findPrimaryTenantSlug(userId);
    if (slug) {
      return NextResponse.redirect(tenantBaseUrl(slug), { status: 303 });
    }
  }

  return NextResponse.redirect(`${appHostBaseUrl()}${next}`, { status: 303 });
}
