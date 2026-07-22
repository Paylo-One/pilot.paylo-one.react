import { describe, expect, it } from "vitest";

import {
  mapPaddleSubscriptionStatus,
  subscriptionGrantsAccess,
  type PaddleScheduledChange,
} from "./paddle-status";

describe("mapPaddleSubscriptionStatus", () => {
  it.each([
    ["trialing", "trialing"],
    ["active", "active"],
    ["past_due", "past_due"],
    ["canceled", "cancelled"],
    ["paused", "suspended"],
  ] as const)("maps Paddle %s to internal %s", (paddle, internal) => {
    expect(mapPaddleSubscriptionStatus(paddle)).toBe(internal);
  });

  it("collapses unknown statuses to suspended (never silently grants access)", () => {
    expect(mapPaddleSubscriptionStatus("some_future_status")).toBe("suspended");
    expect(subscriptionGrantsAccess(mapPaddleSubscriptionStatus("some_future_status"))).toBe(
      false,
    );
  });
});

describe("subscriptionGrantsAccess", () => {
  const scheduledCancel: PaddleScheduledChange = {
    action: "cancel",
    effectiveAt: "2026-08-01T00:00:00Z",
  };
  const scheduledPause: PaddleScheduledChange = {
    action: "pause",
    effectiveAt: "2026-08-01T00:00:00Z",
    resumeAt: "2026-09-01T00:00:00Z",
  };

  it.each([
    // [status, scheduledChange, grants]
    ["active", null, true],
    ["trialing", null, true],
    ["past_due", null, true], // banner-only per ADR-053 posture
    ["grace", null, true],
    ["canceled", null, false],
    ["cancelled", null, false],
    ["expired", null, false],
    ["paused", null, false],
    ["suspended", null, false],
    ["unpaid", null, false],
    ["incomplete", null, false],
    ["", null, false],
  ] as const)("status %s (change: %o) -> %s", (status, change, grants) => {
    expect(subscriptionGrantsAccess(status, change)).toBe(grants);
  });

  it("a scheduled cancel NEVER revokes access by itself", () => {
    expect(subscriptionGrantsAccess("active", scheduledCancel)).toBe(true);
    expect(subscriptionGrantsAccess("trialing", scheduledCancel)).toBe(true);
    expect(subscriptionGrantsAccess("past_due", scheduledCancel)).toBe(true);
  });

  it("a scheduled pause NEVER revokes access by itself", () => {
    expect(subscriptionGrantsAccess("active", scheduledPause)).toBe(true);
    expect(subscriptionGrantsAccess("trialing", scheduledPause)).toBe(true);
  });

  it("a scheduled resume does not grant access to a paused subscription", () => {
    const scheduledResume: PaddleScheduledChange = {
      action: "resume",
      effectiveAt: "2026-08-01T00:00:00Z",
    };
    expect(subscriptionGrantsAccess("paused", scheduledResume)).toBe(false);
    expect(subscriptionGrantsAccess("suspended", scheduledResume)).toBe(false);
  });
});
