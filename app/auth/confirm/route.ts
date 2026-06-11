/**
 * /auth/confirm — completes magic-link sign-in via the SSR token_hash pattern.
 * The custom magic-link email links here with `token_hash` + `type`; we verify
 * the OTP server-side (sets the session cookie, apex-scoped) and redirect to
 * `next` (default /onboarding). Also accepts a PKCE `code` as a fallback.
 *
 * Using a query param (not a URL hash) means the session is established on the
 * server; the hash-fragment implicit flow never reaches server code.
 * authentication-architecture.md §5.
 */

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { appHostBaseUrl, tenantBaseUrl } from "@/lib/config";
import { findPrimaryTenantSlug } from "@/modules/identity-tenant/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/onboarding";

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

  if (errorMessage) {
    return NextResponse.redirect(
      `${appHostBaseUrl()}/sign-in?error=${encodeURIComponent(errorMessage)}`,
    );
  }

  // If the user already owns a workspace, skip onboarding and go straight to it.
  if (userId) {
    const slug = await findPrimaryTenantSlug(userId);
    if (slug) {
      return NextResponse.redirect(tenantBaseUrl(slug));
    }
  }

  const target = next.startsWith("/") ? `${appHostBaseUrl()}${next}` : next;
  return NextResponse.redirect(target);
}
