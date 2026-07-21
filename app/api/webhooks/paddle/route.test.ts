import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { processPaddleWebhookEvent } = vi.hoisted(() => ({
  processPaddleWebhookEvent: vi.fn(),
}));

// Processing is mocked; signature verification runs the REAL Paddle SDK path
// (modules/billing/paddle → @paddle/paddle-node-sdk Webhooks.unmarshal).
vi.mock("@/modules/billing/paddle-webhooks", () => ({
  processPaddleWebhookEvent,
}));

import { POST } from "./route";

const secret = "pdl_ntfset_test_secret";

function signedHeader(body: string, key = secret, timestamp?: number): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const h1 = createHmac("sha256", key).update(`${ts}:${body}`).digest("hex");
  return `ts=${ts};h1=${h1}`;
}

function webhookRequest(body: string, signature: string | null): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["paddle-signature"] = signature;
  return new Request("http://localhost/api/webhooks/paddle", {
    method: "POST",
    headers,
    body,
  });
}

const eventBody = JSON.stringify({
  event_id: "evt_123",
  event_type: "customer.created",
  occurred_at: "2026-07-21T10:00:00Z",
  notification_id: "ntf_123",
  data: { id: "ctm_1", email: "buyer@example.com" },
});

describe("POST /api/webhooks/paddle", () => {
  beforeEach(() => {
    process.env.PADDLE_WEBHOOK_SECRET = secret;
    processPaddleWebhookEvent.mockReset().mockResolvedValue({
      duplicate: false,
      handled: true,
    });
  });

  afterEach(() => {
    delete process.env.PADDLE_WEBHOOK_SECRET;
  });

  it("verifies a valid signature and processes the event", async () => {
    const response = await POST(webhookRequest(eventBody, signedHeader(eventBody)));

    expect(response.status).toBe(200);
    expect(processPaddleWebhookEvent).toHaveBeenCalledTimes(1);
    const event = processPaddleWebhookEvent.mock.calls[0]![0];
    expect(event.eventId).toBe("evt_123");
    expect(event.eventType).toBe("customer.created");
    expect(event.data).toMatchObject({ id: "ctm_1", email: "buyer@example.com" });
  });

  it("rejects an invalid signature with non-2xx and writes nothing", async () => {
    const response = await POST(
      webhookRequest(eventBody, signedHeader(eventBody, "wrong_secret")),
    );

    expect(response.status).toBe(400);
    expect(processPaddleWebhookEvent).not.toHaveBeenCalled();
  });

  it("rejects a missing signature header with non-2xx and writes nothing", async () => {
    const response = await POST(webhookRequest(eventBody, null));

    expect(response.status).toBe(400);
    expect(processPaddleWebhookEvent).not.toHaveBeenCalled();
  });

  it("verifies the RAW body: a tampered payload fails against a signature for the original", async () => {
    const signature = signedHeader(eventBody);
    const tampered = eventBody.replace("buyer@example.com", "attacker@example.com");

    const response = await POST(webhookRequest(tampered, signature));

    expect(response.status).toBe(400);
    expect(processPaddleWebhookEvent).not.toHaveBeenCalled();
  });

  it("answers 500 (so Paddle retries) when the signing secret is not configured", async () => {
    delete process.env.PADDLE_WEBHOOK_SECRET;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(webhookRequest(eventBody, signedHeader(eventBody)));

    expect(response.status).toBe(500);
    expect(processPaddleWebhookEvent).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("answers non-2xx when processing fails after verification (Paddle redelivers)", async () => {
    processPaddleWebhookEvent.mockRejectedValue(new Error("db down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(webhookRequest(eventBody, signedHeader(eventBody)));

    expect(response.status).toBe(500);
    consoleError.mockRestore();
  });

  it("acknowledges a duplicate event id with 200 (at-least-once delivery)", async () => {
    processPaddleWebhookEvent.mockResolvedValue({ duplicate: true, handled: true });

    const response = await POST(webhookRequest(eventBody, signedHeader(eventBody)));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ received: true, duplicate: true });
  });
});
