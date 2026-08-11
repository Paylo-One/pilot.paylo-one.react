import { describe, expect, it } from "vitest";
import {
  accessGrantForSignup,
  openSignupEnabled,
  signupMode,
} from "./signup-policy";

describe("signup policy", () => {
  it("fails closed when configuration is absent", () => {
    expect(signupMode(undefined)).toBe("gated");
    expect(openSignupEnabled(undefined)).toBe(false);
    expect(accessGrantForSignup(undefined)).toBe("paid");
  });

  it("allows an operator to explicitly enable open registration", () => {
    expect(signupMode(" open ")).toBe("open");
    expect(openSignupEnabled("open")).toBe(true);
    expect(accessGrantForSignup("open")).toBe("complimentary");
  });

  it("rejects malformed configuration instead of guessing", () => {
    expect(() => signupMode("public")).toThrow(
      'PILOT_SIGNUP_MODE must be "gated" or "open"',
    );
  });
});
