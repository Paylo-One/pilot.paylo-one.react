"use server";

/**
 * Onboarding server action: claim a subdomain and provision the tenant
 * workspace for the signed-in user, then redirect to <slug>.<apex>.
 * multi-tenancy-design.md §"Tenant Provisioning".
 */

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  getSignedInUser,
  provisionTenantForUser,
} from "@/modules/identity-tenant/server";
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

export async function createWorkspace(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const user = await getSignedInUser();
  if (!user) redirect("/sign-in");

  const parsed = schema.safeParse({
    subdomain: formData.get("subdomain"),
    workspaceName: formData.get("workspaceName") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  let redirectTo: string;
  try {
    const result = await provisionTenantForUser({
      userId: user.userId,
      email: user.email,
      desiredSubdomain: parsed.data.subdomain,
      tenantName: parsed.data.workspaceName,
    });
    redirectTo = result.redirectTo;
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown";
    if (code === "subdomain_taken") {
      return { error: "That subdomain is already taken. Try another." };
    }
    if (code === "invalid_subdomain") {
      return { error: "Choose 3–32 letters, numbers, or hyphens." };
    }
    return { error: "Could not create your workspace. Please try again." };
  }

  redirect(redirectTo);
}
