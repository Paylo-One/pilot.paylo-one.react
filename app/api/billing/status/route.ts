import { NextResponse } from "next/server";
import { resolveTenantContext } from "@/modules/identity-tenant/server";
import { getBillingAccess } from "@/modules/billing/access";
import { getTenantAccess } from "@/modules/identity-tenant/access";

export async function GET() {
  const resolution = await resolveTenantContext();
  if (resolution.kind !== "ok") {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const [billing, tenantAccess] = await Promise.all([
    getBillingAccess(resolution.context.tenantId),
    getTenantAccess(resolution.context.tenantId),
  ]);
  return NextResponse.json({ billing, tenantAccess });
}
