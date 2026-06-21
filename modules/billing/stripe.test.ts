import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { verifyStripeWebhookPayload } from "./stripe";

describe("verifyStripeWebhookPayload", () => {
  const previous = process.env.STRIPE_WEBHOOK_SECRET;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    } else {
      process.env.STRIPE_WEBHOOK_SECRET = previous;
    }
  });

  it("accepts a valid Stripe signature", () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const payload = JSON.stringify({
      id: "evt_123",
      type: "checkout.session.completed",
      data: { object: { id: "cs_test" } },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", "whsec_test")
      .update(`${timestamp}.${payload}`)
      .digest("hex");

    const event = verifyStripeWebhookPayload(payload, `t=${timestamp},v1=${signature}`);
    expect(event.id).toBe("evt_123");
  });

  it("rejects an invalid signature", () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const payload = JSON.stringify({ id: "evt_123", data: { object: {} } });
    const timestamp = Math.floor(Date.now() / 1000);
    expect(() =>
      verifyStripeWebhookPayload(payload, `t=${timestamp},v1=00`),
    ).toThrow("Stripe signature verification failed.");
  });
});
