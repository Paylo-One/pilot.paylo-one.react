import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { configuredPlanFromPriceId, verifyStripeWebhookPayload } from "./stripe";

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

describe("configuredPlanFromPriceId", () => {
  const previousBasic = process.env.STRIPE_PRICE_BASIC_MONTHLY;
  const previousBasicAnnual = process.env.STRIPE_PRICE_BASIC_ANNUAL;
  const previousExecutive = process.env.STRIPE_PRICE_EXECUTIVE_MONTHLY;
  const previousExecutiveAnnual = process.env.STRIPE_PRICE_EXECUTIVE_ANNUAL;

  afterEach(() => {
    if (previousBasic === undefined) {
      delete process.env.STRIPE_PRICE_BASIC_MONTHLY;
    } else {
      process.env.STRIPE_PRICE_BASIC_MONTHLY = previousBasic;
    }
    if (previousExecutive === undefined) {
      delete process.env.STRIPE_PRICE_EXECUTIVE_MONTHLY;
    } else {
      process.env.STRIPE_PRICE_EXECUTIVE_MONTHLY = previousExecutive;
    }
    if (previousBasicAnnual === undefined) {
      delete process.env.STRIPE_PRICE_BASIC_ANNUAL;
    } else {
      process.env.STRIPE_PRICE_BASIC_ANNUAL = previousBasicAnnual;
    }
    if (previousExecutiveAnnual === undefined) {
      delete process.env.STRIPE_PRICE_EXECUTIVE_ANNUAL;
    } else {
      process.env.STRIPE_PRICE_EXECUTIVE_ANNUAL = previousExecutiveAnnual;
    }
  });

  it("maps configured price ids back to local plan keys", () => {
    process.env.STRIPE_PRICE_BASIC_MONTHLY = "price_basic";
    process.env.STRIPE_PRICE_BASIC_ANNUAL = "price_basic_annual";
    process.env.STRIPE_PRICE_EXECUTIVE_MONTHLY = "price_exec";
    process.env.STRIPE_PRICE_EXECUTIVE_ANNUAL = "price_exec_annual";

    expect(configuredPlanFromPriceId("price_basic")?.planKey).toBe("plan_operator");
    expect(configuredPlanFromPriceId("price_basic_annual")?.planKey).toBe("plan_operator");
    expect(configuredPlanFromPriceId("price_exec")?.planKey).toBe("plan_executive");
    expect(configuredPlanFromPriceId("price_exec_annual")?.planKey).toBe("plan_executive");
    expect(configuredPlanFromPriceId("price_exec_annual")?.priceOption.interval).toBe("annual");
    expect(configuredPlanFromPriceId("price_unknown")).toBeNull();
  });
});
