"use server";

/**
 * Server actions for beta invitations on the Settings surface. Tenant context
 * is re-derived server-side; the allowance cap and all writes are enforced by
 * the beta-invitations module (service-role, explicit predicates). Both actions
 * record to the append-only audit trail and revalidate Settings so the list and
 * the remaining-count refresh.
 */

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { betaInvitationService } from "@/modules/beta-invitations";
import { auditService } from "@/modules/audit";
import type { InvitationFormState } from "./invitation-types";

export async function sendInvitationAction(
  _prev: InvitationFormState,
  formData: FormData,
): Promise<InvitationFormState> {
  const ctx = await requireTenantContext();
  const email = String(formData.get("email") ?? "");

  const result = await betaInvitationService.create(ctx, email);
  if (!result.ok) {
    return { status: "error", message: result.error.message };
  }

  await auditService.record(ctx, {
    action: "beta_invitation.sent",
    target: result.value.id,
    metadata: { email: result.value.email },
  });

  revalidatePath("/settings");
  return {
    status: "ok",
    message: `Invitation created for ${result.value.email}.`,
  };
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const result = await betaInvitationService.revoke(ctx, id);
  if (result.ok) {
    await auditService.record(ctx, {
      action: "beta_invitation.revoked",
      target: id,
    });
    revalidatePath("/settings");
  }
}
