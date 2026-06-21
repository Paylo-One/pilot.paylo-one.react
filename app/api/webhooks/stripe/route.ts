import { NextResponse } from "next/server";
import { processStripeWebhookEvent } from "@/modules/billing/webhooks";
import { verifyStripeWebhookPayload } from "@/modules/billing/stripe";

export async function POST(request: Request) {
  const payload = await request.text();
  try {
    const event = verifyStripeWebhookPayload(
      payload,
      request.headers.get("stripe-signature"),
    );
    const result = await processStripeWebhookEvent(event);
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid webhook." },
      { status: 400 },
    );
  }
}
