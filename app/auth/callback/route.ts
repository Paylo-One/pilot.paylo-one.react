/**
 * /auth/callback — completes the magic-link sign-in. The email link returns
 * here with a PKCE `code`; we exchange it for a session (cookies persisted via
 * @supabase/ssr, apex-scoped), then redirect to `next` (default /onboarding).
 *
 * authentication-architecture.md §5 (login), §8 (tenant resolved separately).
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { apexBaseUrl } from "@/lib/config";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/onboarding";

  if (!code) {
    return NextResponse.redirect(`${apexBaseUrl()}/sign-in?error=missing_code`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${apexBaseUrl()}/sign-in?error=${encodeURIComponent(error.message)}`,
    );
  }

  // `next` is an app-relative path; resolve against the apex base URL.
  const target = next.startsWith("/") ? `${apexBaseUrl()}${next}` : next;
  return NextResponse.redirect(target);
}
