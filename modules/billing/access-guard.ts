import "server-only";

import { redirect } from "next/navigation";
import type { TenantContext } from "@/modules/shared";
import { getBillingAccess } from "./access";

const ALLOWED_RESTRICTED_PATHS = [
  "/billing",
  "/settings/billing",
  "/account-inactive",
  "/auth/signout",
];

export function isBillingRouteAllowedWhileRestricted(pathname: string): boolean {
  return ALLOWED_RESTRICTED_PATHS.some(
    (allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`),
  );
}

export async function enforceBillingAccessForPath(
  ctx: TenantContext,
  pathname: string | null,
): Promise<void> {
  const access = await getBillingAccess(ctx.tenantId);
  if (!access || access.accessStatus === "active") return;
  const path = pathname || "/";
  if (isBillingRouteAllowedWhileRestricted(path)) return;
  redirect("/account-inactive");
}
