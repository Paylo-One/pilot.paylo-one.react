import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase, type FakeSupabase } from "../../test/fakes/fake-supabase";

const state = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/lib/supabase/secret", () => ({
  createSupabaseSecretClient: () => state.db,
}));

import {
  linkPaddleCustomerByEmail,
  linkPaddleCustomerToTenant,
  processPaddleWebhookEvent,
  type PaddleWebhookEvent,
} from "./paddle-webhooks";

let db: FakeSupabase;

beforeEach(() => {
  db = createFakeSupabase();
  state.db = db;
});

function customerEvent(overrides: {
  eventId?: string;
  eventType?: "customer.created" | "customer.updated";
  occurredAt?: string;
  id?: string;
  email?: string;
  customData?: Record<string, unknown> | null;
}): PaddleWebhookEvent {
  return {
    eventId: overrides.eventId ?? "evt_customer_1",
    eventType: overrides.eventType ?? "customer.created",
    occurredAt: overrides.occurredAt ?? "2026-07-21T10:00:00Z",
    data: {
      id: overrides.id ?? "ctm_1",
      email: overrides.email ?? "buyer@example.com",
      customData: overrides.customData ?? null,
    },
  };
}

function subscriptionEvent(overrides: {
  eventId?: string;
  eventType?: string;
  occurredAt?: string;
  id?: string;
  status?: string;
  customerId?: string;
  customData?: Record<string, unknown> | null;
  scheduledChange?: { action: "cancel" | "pause" | "resume"; effectiveAt: string } | null;
}): PaddleWebhookEvent {
  return {
    eventId: overrides.eventId ?? "evt_sub_1",
    eventType: overrides.eventType ?? "subscription.created",
    occurredAt: overrides.occurredAt ?? "2026-07-21T10:00:00Z",
    data: {
      id: overrides.id ?? "sub_1",
      status: overrides.status ?? "active",
      customerId: overrides.customerId ?? "ctm_1",
      currencyCode: "USD",
      customData: overrides.customData ?? null,
      currentBillingPeriod: {
        startsAt: "2026-07-21T00:00:00Z",
        endsAt: "2026-08-21T00:00:00Z",
      },
      billingCycle: { interval: "month" },
      scheduledChange: overrides.scheduledChange ?? null,
      items: [{ price: { id: "pri_pro_m", productId: "pro_prod_1" } }],
    },
  };
}

describe("processPaddleWebhookEvent — ledger idempotency", () => {
  it("ledgers every event and acknowledges a replayed event id without reprocessing", async () => {
    const event = customerEvent({ eventId: "evt_dup" });

    const first = await processPaddleWebhookEvent(event);
    expect(first).toMatchObject({ duplicate: false, handled: true });
    expect(db.tables.billing_events).toHaveLength(1);
    expect(db.tables.paddle_customers).toHaveLength(1);

    // Same event id delivered twice (at-least-once delivery): single application.
    db.tables.paddle_customers[0]!.email = "sentinel@example.com";
    const second = await processPaddleWebhookEvent(event);
    expect(second).toMatchObject({ duplicate: true, handled: true });
    expect(db.tables.billing_events).toHaveLength(1);
    expect(db.tables.paddle_customers[0]!.email).toBe("sentinel@example.com");
  });

  it("ledgers unexpected event types without any state change", async () => {
    const result = await processPaddleWebhookEvent({
      eventId: "evt_other",
      eventType: "address.created",
      occurredAt: "2026-07-21T10:00:00Z",
      data: { id: "add_1" },
    });
    expect(result).toMatchObject({ duplicate: false, handled: false });
    expect(db.tables.billing_events).toHaveLength(1);
    expect(db.tables.paddle_customers).toHaveLength(0);
    expect(db.tables.tenant_subscriptions).toHaveLength(0);
  });
});

describe("customer upsert + linking", () => {
  it("mirrors an anonymous customer with tenant_id null (marketing-site checkout)", async () => {
    await processPaddleWebhookEvent(customerEvent({}));
    expect(db.tables.paddle_customers).toEqual([
      { customer_id: "ctm_1", email: "buyer@example.com", tenant_id: null },
    ]);
  });

  it("links via custom_data.tenant_id and never blanks an existing link", async () => {
    await processPaddleWebhookEvent(
      customerEvent({ eventId: "evt_1", customData: { tenant_id: "tenant-1" } }),
    );
    expect(db.tables.paddle_customers[0]!.tenant_id).toBe("tenant-1");

    // A later update WITHOUT custom_data keeps the link.
    await processPaddleWebhookEvent(
      customerEvent({
        eventId: "evt_2",
        eventType: "customer.updated",
        email: "renamed@example.com",
      }),
    );
    expect(db.tables.paddle_customers[0]!).toMatchObject({
      email: "renamed@example.com",
      tenant_id: "tenant-1",
    });
  });
});

describe("subscription mirroring", () => {
  it("stages a subscription whose customer has no tenant yet", async () => {
    await processPaddleWebhookEvent(customerEvent({ eventId: "evt_c" }));
    await processPaddleWebhookEvent(subscriptionEvent({ eventId: "evt_s" }));

    expect(db.tables.tenant_subscriptions).toHaveLength(0);
    expect(db.tables.paddle_subscriptions_unlinked).toHaveLength(1);
    expect(db.tables.paddle_subscriptions_unlinked[0]!).toMatchObject({
      subscription_id: "sub_1",
      customer_id: "ctm_1",
      status: "active",
      price_id: "pri_pro_m",
    });
  });

  it("upserts tenant_subscriptions for a linked customer with mapped status", async () => {
    await processPaddleWebhookEvent(
      customerEvent({ eventId: "evt_c", customData: { tenant_id: "tenant-1" } }),
    );
    await processPaddleWebhookEvent(subscriptionEvent({ eventId: "evt_s" }));

    expect(db.tables.tenant_subscriptions).toHaveLength(1);
    expect(db.tables.tenant_subscriptions[0]!).toMatchObject({
      tenant_id: "tenant-1",
      provider: "paddle",
      provider_customer_id: "ctm_1",
      provider_subscription_id: "sub_1",
      status: "active",
      paddle_price_id: "pri_pro_m",
      current_period_end: "2026-08-21T00:00:00Z",
    });

    // canceled → cancelled (existing vocabulary); paused → suspended.
    await processPaddleWebhookEvent(
      subscriptionEvent({
        eventId: "evt_s2",
        eventType: "subscription.canceled",
        status: "canceled",
        occurredAt: "2026-07-22T10:00:00Z",
      }),
    );
    expect(db.tables.tenant_subscriptions).toHaveLength(1);
    expect(db.tables.tenant_subscriptions[0]!.status).toBe("cancelled");
  });

  it("maps a paused subscription to the internal suspended state", async () => {
    await processPaddleWebhookEvent(
      customerEvent({ eventId: "evt_c", customData: { tenant_id: "tenant-1" } }),
    );
    await processPaddleWebhookEvent(
      subscriptionEvent({ eventId: "evt_s", status: "paused" }),
    );
    expect(db.tables.tenant_subscriptions[0]!.status).toBe("suspended");
  });

  it("mirrors a scheduled change without touching the status", async () => {
    await processPaddleWebhookEvent(
      customerEvent({ eventId: "evt_c", customData: { tenant_id: "tenant-1" } }),
    );
    await processPaddleWebhookEvent(
      subscriptionEvent({
        eventId: "evt_s",
        scheduledChange: { action: "cancel", effectiveAt: "2026-08-21T00:00:00Z" },
      }),
    );
    expect(db.tables.tenant_subscriptions[0]!).toMatchObject({
      status: "active",
      cancel_at_period_end: true,
      scheduled_change_action: "cancel",
      scheduled_change_effective_at: "2026-08-21T00:00:00Z",
    });
  });

  it("takes over the tenant's existing live subscription row instead of inserting a second", async () => {
    db.tables.tenant_subscriptions.push({
      id: "row-1",
      tenant_id: "tenant-1",
      provider: "stripe",
      provider_subscription_id: null,
      status: "trialing",
    });
    await processPaddleWebhookEvent(
      customerEvent({ eventId: "evt_c", customData: { tenant_id: "tenant-1" } }),
    );
    await processPaddleWebhookEvent(subscriptionEvent({ eventId: "evt_s" }));

    expect(db.tables.tenant_subscriptions).toHaveLength(1);
    expect(db.tables.tenant_subscriptions[0]!).toMatchObject({
      id: "row-1",
      provider: "paddle",
      provider_subscription_id: "sub_1",
      status: "active",
    });
  });

  it("ignores an event older than the last applied event (out-of-order guard)", async () => {
    await processPaddleWebhookEvent(
      customerEvent({ eventId: "evt_c", customData: { tenant_id: "tenant-1" } }),
    );
    await processPaddleWebhookEvent(
      subscriptionEvent({
        eventId: "evt_newer",
        eventType: "subscription.updated",
        status: "active",
        occurredAt: "2026-07-22T10:00:00Z",
      }),
    );
    const stale = await processPaddleWebhookEvent(
      subscriptionEvent({
        eventId: "evt_older",
        eventType: "subscription.updated",
        status: "past_due",
        occurredAt: "2026-07-21T09:00:00Z",
      }),
    );

    expect(stale).toMatchObject({ duplicate: false, handled: true, skipped: true });
    expect(db.tables.tenant_subscriptions[0]!.status).toBe("active");
    // The stale event is still ledgered.
    expect(db.tables.billing_events).toHaveLength(3);
  });

  it("guards out-of-order delivery for unlinked (staged) subscriptions too", async () => {
    await processPaddleWebhookEvent(
      subscriptionEvent({ eventId: "evt_newer", occurredAt: "2026-07-22T10:00:00Z" }),
    );
    const stale = await processPaddleWebhookEvent(
      subscriptionEvent({
        eventId: "evt_older",
        status: "past_due",
        occurredAt: "2026-07-21T09:00:00Z",
      }),
    );
    expect(stale.skipped).toBe(true);
    expect(db.tables.paddle_subscriptions_unlinked[0]!.status).toBe("active");
  });
});

describe("transaction.completed", () => {
  it("touches period fields only — no status or access side effects", async () => {
    await processPaddleWebhookEvent(
      customerEvent({ eventId: "evt_c", customData: { tenant_id: "tenant-1" } }),
    );
    await processPaddleWebhookEvent(subscriptionEvent({ eventId: "evt_s" }));

    const result = await processPaddleWebhookEvent({
      eventId: "evt_txn",
      eventType: "transaction.completed",
      occurredAt: "2026-08-21T00:00:01Z",
      data: {
        id: "txn_1",
        customerId: "ctm_1",
        subscriptionId: "sub_1",
        billingPeriod: {
          startsAt: "2026-08-21T00:00:00Z",
          endsAt: "2026-09-21T00:00:00Z",
        },
      },
    });

    expect(result).toMatchObject({ duplicate: false, handled: true });
    expect(db.tables.tenant_subscriptions[0]!).toMatchObject({
      status: "active",
      current_period_start: "2026-08-21T00:00:00Z",
      current_period_end: "2026-09-21T00:00:00Z",
    });
  });
});

describe("linking helpers", () => {
  it("linkPaddleCustomerToTenant promotes staged subscriptions and stamps them (never deletes)", async () => {
    await processPaddleWebhookEvent(customerEvent({ eventId: "evt_c" }));
    await processPaddleWebhookEvent(subscriptionEvent({ eventId: "evt_s" }));
    expect(db.tables.tenant_subscriptions).toHaveLength(0);

    const result = await linkPaddleCustomerToTenant("ctm_1", "tenant-9");

    expect(result.promoted).toBe(1);
    expect(db.tables.paddle_customers[0]!.tenant_id).toBe("tenant-9");
    expect(db.tables.tenant_subscriptions).toHaveLength(1);
    expect(db.tables.tenant_subscriptions[0]!).toMatchObject({
      tenant_id: "tenant-9",
      provider: "paddle",
      provider_subscription_id: "sub_1",
      status: "active",
    });
    // Staged row is stamped promoted, not deleted (fulfilment state).
    expect(db.tables.paddle_subscriptions_unlinked).toHaveLength(1);
    expect(db.tables.paddle_subscriptions_unlinked[0]!.promoted_at).toBeTruthy();
    expect(db.tables.paddle_subscriptions_unlinked[0]!.promoted_tenant_id).toBe("tenant-9");
  });

  it("customer.updated carrying custom_data.tenant_id promotes staged subscriptions", async () => {
    await processPaddleWebhookEvent(customerEvent({ eventId: "evt_c" }));
    await processPaddleWebhookEvent(subscriptionEvent({ eventId: "evt_s" }));
    expect(db.tables.tenant_subscriptions).toHaveLength(0);

    await processPaddleWebhookEvent(
      customerEvent({
        eventId: "evt_c2",
        eventType: "customer.updated",
        customData: { tenant_id: "tenant-9" },
      }),
    );

    expect(db.tables.tenant_subscriptions).toHaveLength(1);
    expect(db.tables.tenant_subscriptions[0]!.tenant_id).toBe("tenant-9");
  });

  it("linkPaddleCustomerByEmail links unlinked customers case-insensitively", async () => {
    await processPaddleWebhookEvent(
      customerEvent({ eventId: "evt_c", email: "Buyer@Example.com" }),
    );
    await processPaddleWebhookEvent(subscriptionEvent({ eventId: "evt_s" }));

    const result = await linkPaddleCustomerByEmail("buyer@example.com", "tenant-9");

    expect(result).toEqual({ linked: 1, promoted: 1 });
    expect(db.tables.paddle_customers[0]!.tenant_id).toBe("tenant-9");
    expect(db.tables.tenant_subscriptions[0]!.tenant_id).toBe("tenant-9");
  });

  it("linkPaddleCustomerByEmail never re-links an already linked customer", async () => {
    await processPaddleWebhookEvent(
      customerEvent({ eventId: "evt_c", customData: { tenant_id: "tenant-1" } }),
    );
    const result = await linkPaddleCustomerByEmail("buyer@example.com", "tenant-2");
    expect(result).toEqual({ linked: 0, promoted: 0 });
    expect(db.tables.paddle_customers[0]!.tenant_id).toBe("tenant-1");
  });
});
