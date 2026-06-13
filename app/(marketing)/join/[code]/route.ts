/**
 * app/(marketing)/join/[code]/route.ts
 *
 * Public referral landing. Someone shares their personal link
 * (`<apex>/join/<code>`); a visitor who opens it has the code validated and,
 * if it is still active with remaining allowance, stored as an apex-scoped
 * cookie before being sent to registration. Onboarding revalidates and
 * atomically reserves the referral before provisioning. No session is required
 * or created here.
 *
 * Invalid, suspended, or exhausted codes redirect to a calm notice rather than
 * surfacing an error — the visitor should never see plumbing.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  REFERRAL_COOKIE,
  REFERRAL_TTL_SECONDS,
  referralService,
} from "@/modules/referral";
import { supabaseCookieOptions } from "@/lib/supabase/cookies";
import { appHostBaseUrl } from "@/lib/config";

function unavailableReason(status: string): string {
  return status === "exhausted" || status === "suspended"
    ? "limit-reached"
    : "invalid";
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const result = await referralService.validateCode(code);

  // Auth + onboarding live on the reserved `app.` host. Redirect there with an
  // absolute URL (same convention as requireTenantContext / the auth routes) so
  // the apex-scoped cookie host and the redirect host always agree — and so we
  // never depend on request.url, which the dev server reports as `localhost`.
  const base = appHostBaseUrl();

  if (!result.ok || result.value.status !== "valid" || !result.value.code) {
    const reason = result.ok ? unavailableReason(result.value.status) : "unavailable";
    const response = NextResponse.redirect(
      `${base}/invite-unavailable?reason=${reason}`,
    );
    const options = supabaseCookieOptions();
    response.cookies.set(REFERRAL_COOKIE, "", {
      domain: options.domain,
      path: options.path,
      sameSite: options.sameSite,
      secure: options.secure,
      maxAge: 0,
    });
    return response;
  }

  const response = NextResponse.redirect(`${base}/register`);
  const options = supabaseCookieOptions();
  response.cookies.set(REFERRAL_COOKIE, result.value.code, {
    httpOnly: true,
    domain: options.domain,
    path: options.path,
    sameSite: options.sameSite,
    secure: options.secure,
    maxAge: REFERRAL_TTL_SECONDS,
  });
  return response;
}
