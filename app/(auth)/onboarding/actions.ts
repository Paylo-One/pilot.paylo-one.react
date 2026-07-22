"use server";

/**
 * Onboarding server action: claim a subdomain and provision the tenant
 * workspace for the signed-in user, then redirect to <slug>.<apex>.
 * multi-tenancy-design.md §"Tenant Provisioning".
 *
 * Account creation is gated on legal acceptance: the operator must accept the
 * Terms and Conditions and acknowledge the Privacy Policy. The acceptance is
 * recorded server-side (versions, timestamp, IP, user agent) BEFORE the tenant
 * is provisioned — consent is evidence, and a provisioning retry simply
 * appends another acceptance row to the immutable log.
 */

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  getSignedInUser,
  provisionTenantForUser,
} from "@/modules/identity-tenant/server";
import { recordLegalAcceptances } from "@/modules/legal/server";
import { REFERRAL_COOKIE, referralService } from "@/modules/referral";
import { hasUnlinkedPaddleSubscriptionForEmail } from "@/modules/billing/paddle-webhooks";
import { supabaseCookieOptions } from "@/lib/supabase/cookies";
import { isSelectableSubdomain } from "@/lib/tenant/host";

export interface OnboardingState {
  error: string | null;
}

const schema = z.object({
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .refine(isSelectableSubdomain, "Choose 3–32 letters, numbers, or hyphens."),
  workspaceName: z.string().trim().max(80).optional(),
});

/** First hop of x-forwarded-for (set by the proxy), if parseable. */
function clientIp(forwardedFor: string | null): string | null {
  const first = forwardedFor?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

export async function createWorkspace(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const user = await getSignedInUser();
  if (!user) redirect("/sign-in");

  const cookieStore = await cookies();
  // Cookie is primary; the hidden form field (seeded from the magic link's
  // `?ref=`) is the fallback when the cookie was lost over the email round-trip.
  const formReferral =
    (formData.get("referralCode") as string | null) ?? undefined;
  const candidateReferralCode =
    cookieStore.get(REFERRAL_COOKIE)?.value ?? formReferral;
  const referralValidation = candidateReferralCode
    ? await referralService.validateCode(candidateReferralCode)
    : null;
  const referralCode =
    referralValidation?.ok && referralValidation.value.status === "valid"
      ? candidateReferralCode
      : undefined;

  let hasPaidCheckout = false;
  if (!referralCode && user.email) {
    try {
      hasPaidCheckout = await hasUnlinkedPaddleSubscriptionForEmail(user.email);
    } catch {
      return {
        error: "Could not confirm your subscription. Please try again.",
      };
    }
  }

  if (!referralCode && !hasPaidCheckout) {
    const options = supabaseCookieOptions();
    cookieStore.set(REFERRAL_COOKIE, "", {
      domain: options.domain,
      path: options.path,
      sameSite: options.sameSite,
      secure: options.secure,
      maxAge: 0,
    });
    const reason =
      referralValidation?.ok &&
      (referralValidation.value.status === "exhausted" ||
        referralValidation.value.status === "suspended")
        ? "limit-reached"
        : referralValidation?.ok
          ? "invalid"
          : candidateReferralCode
            ? "unavailable"
            : "referral-required";
    redirect(`/invite-unavailable?reason=${reason}`);
  }

  const parsed = schema.safeParse({
    subdomain: formData.get("subdomain"),
    workspaceName: formData.get("workspaceName") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  // Legal acceptance is mandatory — the checkbox `required` attribute is only
  // a convenience; this is the gate.
  const acceptedTerms = formData.get("acceptTerms") === "on";
  const acceptedPrivacy = formData.get("acceptPrivacy") === "on";
  if (!acceptedTerms || !acceptedPrivacy) {
    return {
      error:
        "Please accept the Terms and Conditions and acknowledge the Privacy Policy to continue.",
    };
  }

  const requestHeaders = await headers();
  try {
    await recordLegalAcceptances({
      userId: user.userId,
      documents: ["terms", "privacy"],
      ipAddress: clientIp(requestHeaders.get("x-forwarded-for")),
      userAgent: requestHeaders.get("user-agent"),
    });
  } catch {
    return { error: "Could not record your acceptance. Please try again." };
  }

  const reservation = referralCode
    ? await referralService.reserve({
        code: referralCode,
        referredUserId: user.userId,
        referredEmail: user.email,
      })
    : null;
  if (reservation && !reservation.ok) {
    return { error: "Could not confirm your invitation. Please try again." };
  }
  if (
    reservation?.ok &&
    (reservation.value.outcome !== "reserved" ||
      !reservation.value.reservationId)
  ) {
    const options = supabaseCookieOptions();
    cookieStore.set(REFERRAL_COOKIE, "", {
      domain: options.domain,
      path: options.path,
      sameSite: options.sameSite,
      secure: options.secure,
      maxAge: 0,
    });
    redirect(
      `/invite-unavailable?reason=${
        reservation.value.outcome === "exhausted" ||
        reservation.value.outcome === "suspended"
          ? "limit-reached"
          : "invalid"
      }`,
    );
  }

  let redirectTo: string;
  let tenantId: string;
  try {
    const result = await provisionTenantForUser({
      userId: user.userId,
      email: user.email,
      desiredSubdomain: parsed.data.subdomain,
      tenantName: parsed.data.workspaceName,
    });
    redirectTo = result.redirectTo;
    tenantId = result.tenantId;
  } catch (err) {
    if (reservation?.ok && reservation.value.reservationId) {
      await referralService.releaseReservation(reservation.value.reservationId);
    }
    const code = err instanceof Error ? err.message : "unknown";
    if (code === "subdomain_taken") {
      return { error: "That subdomain is already taken. Try another." };
    }
    if (code === "invalid_subdomain") {
      return { error: "Choose 3–32 letters, numbers, or hyphens." };
    }
    return { error: "Could not create your workspace. Please try again." };
  }

  if (reservation?.ok && reservation.value.reservationId) {
    await referralService.completeReservation(
      reservation.value.reservationId,
      tenantId,
    );
  }

  // Clear the referral cookie so a later signup in the same browser can't
  // accidentally re-credit a stale code. Match the apex scope it was set with.
  const options = supabaseCookieOptions();
  cookieStore.set(REFERRAL_COOKIE, "", {
    domain: options.domain,
    path: options.path,
    sameSite: options.sameSite,
    secure: options.secure,
    maxAge: 0,
  });

  redirect(redirectTo);
}
