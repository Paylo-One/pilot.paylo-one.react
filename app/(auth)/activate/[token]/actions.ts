"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  activatePreparedTenant,
  inspectPreparedActivation,
  isActivationToken,
} from "@/modules/identity-tenant/activation";
import { getSignedInUser } from "@/modules/identity-tenant/server";
import { recordLegalAcceptances } from "@/modules/legal/server";

export interface ActivationState {
  readonly error: string | null;
}

const schema = z.object({
  token: z.string().refine(isActivationToken, "Activation link is invalid."),
  displayName: z.string().trim().max(100).optional(),
});

function clientIp(forwardedFor: string | null): string | null {
  const first = forwardedFor?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

export async function activateWorkspace(
  _previous: ActivationState,
  formData: FormData,
): Promise<ActivationState> {
  const user = await getSignedInUser();
  if (!user) return { error: "Sign in with the invited email to continue." };

  const parsed = schema.safeParse({
    token: formData.get("token"),
    displayName: formData.get("displayName") ?? undefined,
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Activation link is invalid.",
    };
  }

  const invitation = await inspectPreparedActivation(parsed.data.token);
  if (!invitation) return { error: "Activation invitation was not found." };
  if (invitation.status === "expired") {
    return { error: "This activation link has expired. Ask Operations for a new one." };
  }
  if (invitation.status === "revoked") {
    return { error: "This activation link is no longer active." };
  }
  if (
    !user.email ||
    user.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()
  ) {
    return { error: "Sign in with the email address that received this invitation." };
  }

  if (
    formData.get("acceptTerms") !== "on" ||
    formData.get("acceptPrivacy") !== "on"
  ) {
    return {
      error:
        "Please accept the Terms and Conditions and acknowledge the Privacy Policy.",
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

  let redirectTo: string;
  try {
    const result = await activatePreparedTenant({
      token: parsed.data.token,
      userId: user.userId,
      displayName:
        parsed.data.displayName?.trim() || invitation.contactName || user.email,
    });
    redirectTo = result.redirectTo;
  } catch (error) {
    const code = error instanceof Error ? error.message : "activation_failed";
    if (code === "activation_email_mismatch") {
      return { error: "Sign in with the email address that received this invitation." };
    }
    if (code.includes("another workspace")) {
      return { error: "This account already belongs to another workspace." };
    }
    if (code.includes("expired")) {
      return { error: "This activation link has expired. Ask Operations for a new one." };
    }
    return { error: "Could not activate the workspace. Please try again." };
  }

  redirect(redirectTo);
}
