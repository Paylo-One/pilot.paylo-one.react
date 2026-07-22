import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { paddlePlanFromPriceId, paddlePlanKeyForPriceId, PADDLE_PRICE_OPTIONS } from "./paddle-plans";

const ENV_KEYS = PADDLE_PRICE_OPTIONS.map((option) => option.priceEnv);

describe("paddlePlanFromPriceId", () => {
  const previous: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) previous[key] = process.env[key];
    process.env.PADDLE_PRICE_STARTER_MONTHLY = "pri_starter_m";
    process.env.PADDLE_PRICE_STARTER_ANNUAL = "pri_starter_y";
    process.env.PADDLE_PRICE_PRO_MONTHLY = "pri_pro_m";
    process.env.PADDLE_PRICE_PRO_ANNUAL = "pri_pro_y";
    process.env.PADDLE_PRICE_ADVANCED_MONTHLY = "pri_advanced_m";
    process.env.PADDLE_PRICE_ADVANCED_ANNUAL = "pri_advanced_y";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  it("maps configured Paddle price ids to tiers and intervals", () => {
    expect(paddlePlanFromPriceId("pri_starter_m")).toMatchObject({
      tierKey: "starter",
      interval: "monthly",
    });
    expect(paddlePlanFromPriceId("pri_pro_y")).toMatchObject({
      tierKey: "pro",
      interval: "annual",
    });
    expect(paddlePlanFromPriceId("pri_advanced_m")).toMatchObject({
      tierKey: "advanced",
      interval: "monthly",
    });
  });

  it("bridges tiers onto the provisional legacy plan keys (TODO plan-keys)", () => {
    expect(paddlePlanFromPriceId("pri_starter_y")?.planKey).toBe("plan_operator");
    expect(paddlePlanFromPriceId("pri_pro_m")?.planKey).toBe("plan_executive");
    expect(paddlePlanFromPriceId("pri_advanced_y")?.planKey).toBe("plan_command");
  });

  it("returns null for unknown or missing price ids", () => {
    expect(paddlePlanFromPriceId("pri_unknown")).toBeNull();
    expect(paddlePlanFromPriceId(null)).toBeNull();
    expect(paddlePlanFromPriceId(undefined)).toBeNull();
  });

  it("paddlePlanKeyForPriceId falls back to the lowest tier for unknown prices", () => {
    expect(paddlePlanKeyForPriceId("pri_pro_m")).toBe("plan_executive");
    expect(paddlePlanKeyForPriceId("pri_unknown")).toBe("plan_operator");
  });
});
