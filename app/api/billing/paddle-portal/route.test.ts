import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveTenantContext, createPaddlePortalSession } = vi.hoisted(() => ({
  resolveTenantContext: vi.fn(),
  createPaddlePortalSession: vi.fn(),
}));

vi.mock("@/modules/identity-tenant/server", () => ({ resolveTenantContext }));
vi.mock("@/modules/billing/paddle", () => ({ createPaddlePortalSession }));

import { POST } from "./route";

describe("POST /api/billing/paddle-portal", () => {
  beforeEach(() => {
    resolveTenantContext.mockReset();
    createPaddlePortalSession.mockReset().mockResolvedValue(
      "https://customer-portal.paddle.com/cpl_test",
    );
  });

  it("rejects unauthenticated requests before any Paddle work", async () => {
    resolveTenantContext.mockResolvedValue({ kind: "unauthenticated" });

    const response = await POST();

    expect(response.status).toBe(401);
    expect(createPaddlePortalSession).not.toHaveBeenCalled();
  });

  it("rejects non-member resolutions (fail closed)", async () => {
    resolveTenantContext.mockResolvedValue({
      kind: "forbidden",
      user: { userId: "user-1", email: null },
      slug: "acme",
    });

    const response = await POST();

    expect(response.status).toBe(401);
    expect(createPaddlePortalSession).not.toHaveBeenCalled();
  });

  it("mints a portal session from the SERVER-resolved tenant — a client can never supply a customer id", async () => {
    resolveTenantContext.mockResolvedValue({
      kind: "ok",
      context: {
        tenantId: "tenant-1",
        tenantSlug: "acme",
        userId: "user-1",
        role: "owner",
      },
    });

    // The route handler takes no request argument at all: any body a client
    // sends (e.g. a foreign customer id) is unreadable by design.
    expect(POST.length).toBe(0);

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: "https://customer-portal.paddle.com/cpl_test",
    });
    expect(createPaddlePortalSession).toHaveBeenCalledTimes(1);
    expect(createPaddlePortalSession).toHaveBeenCalledWith({ tenantId: "tenant-1" });
  });

  it("maps portal failures to a 400 with the error message", async () => {
    resolveTenantContext.mockResolvedValue({
      kind: "ok",
      context: {
        tenantId: "tenant-1",
        tenantSlug: "acme",
        userId: "user-1",
        role: "owner",
      },
    });
    createPaddlePortalSession.mockRejectedValue(
      new Error("No Paddle customer is linked to this workspace."),
    );

    const response = await POST();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "No Paddle customer is linked to this workspace.",
    });
  });
});
