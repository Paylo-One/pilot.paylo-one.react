import { NextResponse } from "next/server";
import { tenantBaseUrl } from "@/lib/config";
import { resolveTenantContext } from "@/modules/identity-tenant/server";
import { createSubscriptionPortal } from "@/modules/billing/access";

export async function POST() {
  const resolution = await resolveTenantContext();
  if (resolution.kind !== "ok") {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  try {
    const url = await createSubscriptionPortal({
      ctx: resolution.context,
      returnUrl: `${tenantBaseUrl(resolution.context.tenantSlug)}/billing`,
    });
    return NextResponse.json({ url });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Portal failed." },
      { status: 400 },
    );
  }
}
