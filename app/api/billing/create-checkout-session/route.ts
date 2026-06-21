import { NextResponse } from "next/server";
import { tenantBaseUrl } from "@/lib/config";
import { resolveTenantContext, getSignedInUser } from "@/modules/identity-tenant/server";
import { createSubscriptionCheckout } from "@/modules/billing/access";
import { stripePriceOptionForKey } from "@/modules/billing/stripe-plans";

export async function POST(request: Request) {
  const resolution = await resolveTenantContext();
  if (resolution.kind !== "ok") {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    priceOption?: string;
    tier?: string;
  };
  const priceOption = stripePriceOptionForKey(
    body.priceOption ?? (body.tier ? `${body.tier}_monthly` : "operator_monthly"),
  );
  if (!priceOption) {
    return NextResponse.json({ error: "Unknown billing price option." }, { status: 400 });
  }
  const user = await getSignedInUser();
  try {
    const base = tenantBaseUrl(resolution.context.tenantSlug);
    const session = await createSubscriptionCheckout({
      ctx: resolution.context,
      email: user?.email ?? null,
      priceOptionKey: priceOption.key,
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
