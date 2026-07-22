import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase, type FakeSupabase } from "../../test/fakes/fake-supabase";

const state = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/lib/supabase/secret", () => ({
  createSupabaseSecretClient: () => state.db,
}));

import { createPaddlePortalSession, resolvePaddleCustomerIdForTenant } from "./paddle";

let db: FakeSupabase;

beforeEach(() => {
  db = createFakeSupabase();
  state.db = db;
});

describe("resolvePaddleCustomerIdForTenant", () => {
  it("resolves from paddle_customers first", async () => {
    db.tables.paddle_customers.push({
      customer_id: "ctm_1",
      email: "a@b.c",
      tenant_id: "tenant-1",
    });
    await expect(resolvePaddleCustomerIdForTenant("tenant-1")).resolves.toBe("ctm_1");
  });

  it("falls back to the tenant's Paddle subscription row", async () => {
    db.tables.tenant_subscriptions.push({
      tenant_id: "tenant-1",
      provider: "paddle",
      provider_customer_id: "ctm_2",
      provider_subscription_id: "sub_2",
    });
    await expect(resolvePaddleCustomerIdForTenant("tenant-1")).resolves.toBe("ctm_2");
  });

  it("returns null when nothing is linked", async () => {
    await expect(resolvePaddleCustomerIdForTenant("tenant-1")).resolves.toBeNull();
  });
});

describe("createPaddlePortalSession", () => {
  it("mints a session with the server-resolved customer + subscription ids", async () => {
    db.tables.paddle_customers.push({
      customer_id: "ctm_1",
      email: "a@b.c",
      tenant_id: "tenant-1",
    });
    db.tables.tenant_subscriptions.push({
      tenant_id: "tenant-1",
      provider: "paddle",
      provider_customer_id: "ctm_1",
      provider_subscription_id: "sub_1",
    });
    const createPortalSession = vi.fn().mockResolvedValue({
      urls: { general: { overview: "https://customer-portal.paddle.com/cpl_1" } },
    });

    const url = await createPaddlePortalSession(
      { tenantId: "tenant-1" },
      { db: db as never, createPortalSession },
    );

    expect(url).toBe("https://customer-portal.paddle.com/cpl_1");
    expect(createPortalSession).toHaveBeenCalledWith("ctm_1", ["sub_1"]);
  });

  it("refuses when the tenant has no linked Paddle customer", async () => {
    const createPortalSession = vi.fn();
    await expect(
      createPaddlePortalSession(
        { tenantId: "tenant-1" },
        { db: db as never, createPortalSession },
      ),
    ).rejects.toThrow("No Paddle customer is linked to this workspace.");
    expect(createPortalSession).not.toHaveBeenCalled();
  });
});
