/**
 * /auth/callback — completes the magic-link sign-in. The email link returns
 * here with a PKCE `code`; we exchange it for a session (cookies persisted via
 * @supabase/ssr, apex-scoped), then redirect to `next` (default /onboarding).
 *
 * authentication-architecture.md §5 (login), §8 (tenant resolved separately).
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { appHostBaseUrl, tenantBaseUrl } from "@/lib/config";
import { safeNextPath } from "@/lib/auth-redirect";
import { findPrimaryTenantSlug } from "@/modules/identity-tenant/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next") ?? "/onboarding");

  if (!code) {
    return NextResponse.redirect(`${appHostBaseUrl()}/sign-in?error=missing_code`);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${appHostBaseUrl()}/sign-in?error=${encodeURIComponent(error.message)}`,
    );
  }

  if (next.startsWith("/activate/")) {
    return NextResponse.redirect(`${appHostBaseUrl()}${next}`);
  }

  // If the user already owns a workspace, skip onboarding and go straight to it.
  // We use the userId from the exchange response directly — no cookie round-trip.
  const userId = data.user?.id;
  if (userId) {
    const slug = await findPrimaryTenantSlug(userId);
    if (slug) {
      return NextResponse.redirect(tenantBaseUrl(slug));
    }
  }

  // New user: send to onboarding to claim a subdomain.
  return NextResponse.redirect(`${appHostBaseUrl()}${next}`);
}
