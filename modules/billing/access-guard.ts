import "server-only";

import { redirect } from "next/navigation";
import type { TenantContext } from "@/modules/shared";
import {
  getTenantAccess,
  type TenantAccessRecord,
} from "@/modules/identity-tenant/access";

const ALLOWED_RESTRICTED_PATHS = [
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
): Promise<TenantAccessRecord> {
  const access = await getTenantAccess(ctx.tenantId);
  if (access?.status === "active") return access;
  const path = pathname || "/";
  if (access && isBillingRouteAllowedWhileRestricted(path)) return access;
  redirect("/account-inactive");
}
