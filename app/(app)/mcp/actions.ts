"use server";

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { revokeGrant } from "@/modules/mcp";

export async function revokeMcpGrantAction(formData: FormData) {
  const ctx = await requireTenantContext();
  const grantId = String(formData.get("grantId") ?? "");
  if (!grantId) return;
  await revokeGrant(ctx, grantId);
  revalidatePath("/mcp");
  revalidatePath("/settings");
}
