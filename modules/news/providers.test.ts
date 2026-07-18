import { describe, expect, it, vi } from "vitest";
import { fetchNewsWithRetry } from "./providers";

describe("fetchNewsWithRetry", () => {
  it("honours Retry-After before retrying a 429", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "2" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const response = await fetchNewsWithRetry("https://example.com", undefined, {
      fetcher,
      sleep,
    });

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("does not retry a non-retryable response", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("bad", { status: 400 }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const response = await fetchNewsWithRetry("https://example.com", undefined, {
      fetcher,
      sleep,
    });

    expect(response.status).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("bounds retries to three attempts", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("unavailable", { status: 503 }),
    );
    const sleep = vi.fn().mockResolvedValue(undefined);

    const response = await fetchNewsWithRetry("https://example.com", undefined, {
      fetcher,
      sleep,
    });

    expect(response.status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
