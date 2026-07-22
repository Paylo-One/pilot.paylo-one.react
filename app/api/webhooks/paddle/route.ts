import { NextResponse } from "next/server";
import { paddleWebhookSecret } from "@/lib/config";
import { unmarshalPaddleWebhook } from "@/modules/billing/paddle";
import { processPaddleWebhookEvent } from "@/modules/billing/paddle-webhooks";
import { isLivePaddleWebhookRequest } from "@/modules/billing/paddle-webhook-ips";

/**
 * POST /api/webhooks/paddle — Paddle notification destination endpoint.
 *
 * Operator setup (manual — there is no automation for this): in the Paddle
 * dashboard (sandbox or production, matching PADDLE_ENV) go to Developer
 * tools > Notifications, create a notification destination of type "webhook"
 * pointing at https://<app-domain>/api/webhooks/paddle with the event types
 * subscription.created, subscription.updated, subscription.canceled,
 * customer.created, customer.updated and transaction.completed, then copy the
 * destination's SIGNING SECRET into PADDLE_WEBHOOK_SECRET (this is a separate
 * credential from PADDLE_API_KEY). See README "Paddle fulfilment". Never
 * delete the notification destination or rotate away its secret casually —
 * it is live fulfilment state.
 *
 * Contract: the RAW request body is verified (never parse before verifying);
 * signature failures return non-2xx so Paddle retries nothing silently;
 * missing configuration returns 500 so Paddle retries once configured; every
 * verified event is ledgered into billing_events before processing and
 * replayed event ids are acknowledged without reprocessing.
 */
export async function POST(request: Request) {
  if (process.env.PADDLE_ENV === "production") {
    try {
      if (!(await isLivePaddleWebhookRequest(request))) {
        return NextResponse.json({ error: "Webhook source is not allowed." }, { status: 403 });
      }
    } catch (error) {
      // Fail closed if Paddle's authoritative list cannot be refreshed. A 503
      // keeps the delivery retryable instead of accepting an unverified source.
      console.error("[paddle-webhook] could not verify Paddle source IP", error);
      return NextResponse.json({ error: "Webhook source verification unavailable." }, { status: 503 });
    }
  }

  const rawBody = await request.text();

  try {
    paddleWebhookSecret();
  } catch {
    // Misconfiguration, not a bad request: 500 makes Paddle retry until the
    // signing secret is configured.
    console.error(
      "[paddle-webhook] PADDLE_WEBHOOK_SECRET is not set; cannot verify webhooks.",
    );
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }

  const signature = request.headers.get("paddle-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing Paddle signature." }, { status: 400 });
  }

  let event;
  try {
    event = await unmarshalPaddleWebhook(rawBody, signature);
  } catch {
    return NextResponse.json(
      { error: "Paddle signature verification failed." },
      { status: 400 },
    );
  }

  try {
    const result = await processPaddleWebhookEvent(event);
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    // Processing failed after verification: non-2xx so Paddle redelivers
    // (the billing_events ledger row carries the error for diagnosis).
    console.error("[paddle-webhook] processing failed", error);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
