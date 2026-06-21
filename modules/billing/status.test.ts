import { describe, expect, it } from "vitest";

import {
  isBillingRouteAllowedWhileRestricted,
} from "./access-guard";
import { mapStripeSubscriptionStatus } from "./status";

describe("mapStripeSubscriptionStatus", () => {
  it("allows active and trialing subscriptions", () => {
    expect(mapStripeSubscriptionStatus("active")).toEqual({
      billingStatus: "active",
      accessStatus: "active",
    });
    expect(mapStripeSubscriptionStatus("trialing")).toEqual({
      billingStatus: "trialing",
      accessStatus: "active",
    });
  });

  it("restricts dunning, cancellation, and incomplete states", () => {
    expect(mapStripeSubscriptionStatus("past_due")).toEqual({
      billingStatus: "past_due",
      accessStatus: "restricted",
    });
    expect(mapStripeSubscriptionStatus("unpaid")).toEqual({
      billingStatus: "unpaid",
      accessStatus: "restricted",
    });
    expect(mapStripeSubscriptionStatus("canceled")).toEqual({
      billingStatus: "canceled",
      accessStatus: "restricted",
    });
    expect(mapStripeSubscriptionStatus("incomplete")).toEqual({
      billingStatus: "incomplete",
      accessStatus: "restricted",
    });
    expect(mapStripeSubscriptionStatus("incomplete_expired")).toEqual({
      billingStatus: "expired",
      accessStatus: "restricted",
    });
  });
});

describe("restricted billing routes", () => {
  it("allows billing and account routes while restricted", () => {
    expect(isBillingRouteAllowedWhileRestricted("/billing")).toBe(true);
    expect(isBillingRouteAllowedWhileRestricted("/settings/billing")).toBe(true);
    expect(isBillingRouteAllowedWhileRestricted("/account-inactive")).toBe(true);
    expect(isBillingRouteAllowedWhileRestricted("/auth/signout")).toBe(true);
  });

  it("blocks core product routes while restricted", () => {
    expect(isBillingRouteAllowedWhileRestricted("/briefing")).toBe(false);
    expect(isBillingRouteAllowedWhileRestricted("/actions")).toBe(false);
    expect(isBillingRouteAllowedWhileRestricted("/sources/github")).toBe(false);
  });
});
