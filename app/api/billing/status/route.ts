import { NextResponse } from "next/server";
import { resolveTenantContext } from "@/modules/identity-tenant/server";
import { getBillingAccess } from "@/modules/billing/access";

export async function GET() {
  const resolution = await resolveTenantContext();
  if (resolution.kind !== "ok") {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const access = await getBillingAccess(resolution.context.tenantId);
  return NextResponse.json({ billing: access });
}
