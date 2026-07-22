import { NextResponse } from "next/server";
import { resolveTenantContext } from "@/modules/identity-tenant/server";
import { createPaddlePortalSession } from "@/modules/billing/paddle";

/**
 * POST /api/billing/paddle-portal — mint a Paddle customer-portal session for
 * the signed-in user's tenant and return its URL (mirrors the Stripe
 * create-customer-portal-session route).
 *
 * Security: authentication happens FIRST; the Paddle customer id is resolved
 * SERVER-SIDE from paddle_customers / tenant_subscriptions for the resolved
 * tenant. The request body is intentionally ignored — a client can never
 * supply a customer id.
 */
export async function POST() {
  const resolution = await resolveTenantContext();
  if (resolution.kind !== "ok") {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  try {
    const url = await createPaddlePortalSession({
      tenantId: resolution.context.tenantId,
    });
    return NextResponse.json({ url });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Portal failed." },
      { status: 400 },
    );
  }
}
