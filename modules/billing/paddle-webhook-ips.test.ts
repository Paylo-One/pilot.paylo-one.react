import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPaddleIpCacheForTests,
  livePaddleWebhookIps,
  requestClientIp,
} from "./paddle-webhook-ips";

describe("Paddle webhook IP validation", () => {
  afterEach(() => clearPaddleIpCacheForTests());

  it("reads the edge-provided client address from the first forwarded value", () => {
    const request = new Request("https://app.paylo.one/api/webhooks/paddle", {
      headers: { "x-forwarded-for": "34.232.58.13, 10.0.0.1" },
    });
    expect(requestClientIp(request)).toBe("34.232.58.13");
  });

  it("fetches and validates Paddle's /32 CIDRs without hard-coding addresses", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { ipv4_cidrs: ["34.232.58.13/32", "bad"] } }), {
        status: 200,
      }),
    );

    const addresses = await livePaddleWebhookIps(fetcher, 1);
    expect([...addresses]).toEqual(["34.232.58.13"]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.paddle.com/ips",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
  });

  it("fails closed when Paddle returns no usable addresses", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { ipv4_cidrs: [] } }), { status: 200 }),
    );
    await expect(livePaddleWebhookIps(fetcher, 1)).rejects.toThrow("no valid");
  });
});
