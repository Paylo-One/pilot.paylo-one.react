import { describe, expect, it } from "vitest";
import { openSignupEnabled, signupMode, tenantProvisioningPolicy } from "./signup-policy";

describe("signup policy", () => {
  it("fails closed when configuration is absent", () => {
    expect(signupMode(undefined)).toBe("gated");
    expect(openSignupEnabled(undefined)).toBe(false);
    expect(tenantProvisioningPolicy("gated")).toEqual({
      accessGrantType: "paid",
      paymentEnforcementExempt: false,
      initialiseHostedBilling: true,
    });
  });

  it("allows an operator to explicitly enable open registration", () => {
    expect(signupMode(" open ")).toBe("open");
    expect(openSignupEnabled("open")).toBe(true);
    expect(tenantProvisioningPolicy("open")).toEqual({
      accessGrantType: "complimentary",
      paymentEnforcementExempt: true,
      initialiseHostedBilling: false,
    });
  });

  it("rejects malformed configuration instead of guessing", () => {
    expect(() => signupMode("public")).toThrow(
      'PILOT_SIGNUP_MODE must be "gated" or "open"',
    );
  });
});
