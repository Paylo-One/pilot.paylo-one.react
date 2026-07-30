import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "@/test/fakes/fake-supabase";

let fake: FakeSupabase & {
  auth?: unknown;
  rpc?: unknown;
};

vi.mock("@/lib/supabase/secret", () => ({
  createSupabaseSecretClient: () => fake,
}));

// The briefing-email module reads config at call time; keep SendGrid off so
// delivery tests never attempt the network.
vi.mock("@/lib/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...original,
    sendgridConfigured: () => false,
    tenantBaseUrl: (slug: string) => `https://${slug}.paylo.one`,
    appHostBaseUrl: () => "https://app.paylo.one",
  };
});

const { recordNotification } = await import("./server");
const { runDailyBriefingDelivery } = await import("./briefing-email");

function buildFake(initial: Record<string, Record<string, unknown>[]> = {}) {
  const base = createFakeSupabase(initial, {
    uniqueKeys: {
      notifications: ["tenant_id", "user_id", "kind", "dedupe_key"],
      notification_deliveries: ["tenant_id", "user_id", "kind", "dedupe_key"],
    },
  });
  return Object.assign(base, {
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: { email: "owner@example.com" } },
          error: null,
        }),
      },
    },
  });
}

beforeEach(() => {
  fake = buildFake();
});

describe("recordNotification", () => {
  it("creates one row per underlying event", async () => {
    const input = {
      tenantId: "t1",
      userId: "u1",
      kind: "actions_to_review" as const,
      title: "2 suggested actions need your review.",
      href: "/actions",
      dedupeKey: "run-1",
    };
    const first = await recordNotification(input);
    const second = await recordNotification(input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(fake.tables["notifications"]).toHaveLength(1);
  });

  it("separates events by kind and dedupe key", async () => {
    await recordNotification({
      tenantId: "t1",
      userId: "u1",
      kind: "actions_to_review",
      title: "a",
      dedupeKey: "run-1",
    });
    await recordNotification({
      tenantId: "t1",
      userId: "u1",
      kind: "actions_overdue",
      title: "b",
      dedupeKey: "run-1",
    });
    await recordNotification({
      tenantId: "t1",
      userId: "u1",
      kind: "actions_to_review",
      title: "c",
      dedupeKey: "run-2",
    });
    expect(fake.tables["notifications"]).toHaveLength(3);
  });
});

describe("runDailyBriefingDelivery duplicate-send prevention", () => {
  const input = {
    tenantId: "t1",
    tenantSlug: "acme",
    userId: "u1",
    timezone: "Europe/Amsterdam",
    now: new Date("2026-07-30T07:00:00Z"),
  };

  beforeEach(() => {
    fake = buildFake({
      user_profiles: [
        {
          user_id: "u1",
          daily_briefing_email: true,
          unsubscribe_token: "11111111-1111-4111-8111-111111111111",
        },
      ],
      suggested_actions: [
        {
          id: "a1",
          tenant_id: "t1",
          title: "Chase invoice",
          status: "planned",
          priority: "high",
          due_at: "2026-07-28T10:00:00Z",
          follow_up_at: null,
        },
      ],
    });
  });

  it("claims the day before sending, so a second run is a no-op", async () => {
    const first = await runDailyBriefingDelivery(input);
    const second = await runDailyBriefingDelivery(input);
    // SendGrid is unconfigured in tests, so the first run claims the day and
    // records the skip; the point is the claim, not the provider call.
    expect(first.outcome).toBe("skipped_unconfigured");
    expect(second.outcome).toBe("skipped_duplicate");
    expect(fake.tables["notification_deliveries"]).toHaveLength(1);
  });

  it("skips a user who turned the briefing email off", async () => {
    fake.tables["user_profiles"]![0]!["daily_briefing_email"] = false;
    const result = await runDailyBriefingDelivery(input);
    expect(result.outcome).toBe("skipped_disabled");
    expect(fake.tables["notification_deliveries"] ?? []).toHaveLength(0);
  });

  it("records an empty day without claiming a send", async () => {
    fake.tables["suggested_actions"] = [];
    const result = await runDailyBriefingDelivery(input);
    expect(result.outcome).toBe("skipped_empty");
    expect(fake.tables["notification_deliveries"]![0]!["status"]).toBe("skipped_empty");
  });

  it("raises the overdue in-app nudge exactly once per day", async () => {
    await runDailyBriefingDelivery(input);
    // Second local day: new dedupe key, new claim, new nudge.
    await runDailyBriefingDelivery({ ...input, now: new Date("2026-07-31T07:00:00Z") });
    // Repeat of day two: no extra nudge.
    await runDailyBriefingDelivery({ ...input, now: new Date("2026-07-31T09:00:00Z") });
    const nudges = (fake.tables["notifications"] ?? []).filter(
      (row) => row["kind"] === "actions_overdue",
    );
    expect(nudges).toHaveLength(2);
  });
});
