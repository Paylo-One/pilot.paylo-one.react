import { NextResponse } from "next/server";
import { tenantBaseUrl } from "@/lib/config";
import { resolveTenantContext, getSignedInUser } from "@/modules/identity-tenant/server";
import { createSubscriptionCheckout } from "@/modules/billing/access";

export async function POST() {
  const resolution = await resolveTenantContext();
  if (resolution.kind !== "ok") {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const user = await getSignedInUser();
  try {
    const base = tenantBaseUrl(resolution.context.tenantSlug);
    const session = await createSubscriptionCheckout({
      ctx: resolution.context,
      email: user?.email ?? null,
      successUrl: `${base}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}/billing?checkout=cancelled`,
    });
    if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Checkout failed." },
      { status: 400 },
    );
  }
}
