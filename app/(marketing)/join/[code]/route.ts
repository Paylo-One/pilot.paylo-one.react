/**
 * app/(marketing)/join/[code]/route.ts
 *
 * Public referral landing. Someone shares their personal link
 * (`<apex>/join/<code>`); a visitor who opens it has the code validated and,
 * if it is still active with remaining allowance, stored as an apex-scoped
 * cookie before being sent to sign-in. Onboarding reads (and clears) that
 * cookie to credit the referrer. No session is required or created here.
 *
 * Invalid, suspended, or exhausted codes redirect to a calm notice rather than
 * surfacing an error — the visitor should never see plumbing.
 */

import { NextResponse, type NextRequest } from "next/server";
import { referralService } from "@/modules/referral";
import { supabaseCookieOptions } from "@/lib/supabase/cookies";

/** Must match the cookie name read by the onboarding action. */
const REFERRAL_COOKIE = "paylo_ref";

/** How long a captured referral stays valid for completing onboarding. */
const REFERRAL_TTL_SECONDS = 14 * 24 * 60 * 60;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const result = await referralService.validateCode(code);

  if (!result.ok || !result.value.valid || !result.value.code) {
    return NextResponse.redirect(new URL("/invite-unavailable", request.url));
  }

  const response = NextResponse.redirect(new URL("/sign-in", request.url));
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
