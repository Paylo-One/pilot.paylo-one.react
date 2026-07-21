import { describe, expect, it } from "vitest";
import { EMAIL_PATTERN, readableError } from "./readable-error";

function namedError(name: string, message = ""): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe("readableError — passkey channel", () => {
  it("maps NotAllowedError and cancellation to the cancelled copy", () => {
    expect(readableError(namedError("NotAllowedError"), "sign-in", "passkey")).toMatch(
      /cancelled/,
    );
    expect(
      readableError(new Error("The operation was cancelled"), "sign-in", "passkey"),
    ).toMatch(/cancelled/);
  });

  it("maps InvalidStateError and no-credential messages to the no-passkey copy", () => {
    expect(
      readableError(namedError("InvalidStateError"), "sign-in", "passkey"),
    ).toMatch(/No passkey is registered/);
    expect(
      readableError(new Error("no credentials available"), "sign-in", "passkey"),
    ).toMatch(/No passkey is registered/);
  });

  it("falls back to a generic passkey failure", () => {
    expect(readableError(new Error("something odd"), "sign-in", "passkey")).toMatch(
      /couldn't complete passkey sign-in/,
    );
  });
});

describe("readableError — link channel, account enumeration", () => {
  it.each([
    "Signups not allowed for otp",
    "signup is disabled",
    "otp_disabled",
    "User not found",
  ])("stays neutral (null) for %j during sign-in", (message) => {
    expect(readableError(new Error(message), "sign-in", "link")).toBeNull();
  });

  it("does NOT stay neutral during registration", () => {
    expect(
      readableError(new Error("Signups not allowed for otp"), "registration", "link"),
    ).toMatch(/verification link/);
  });
});

describe("readableError — link channel, transport failures", () => {
  it("maps rate limiting", () => {
    expect(readableError(new Error("Too many requests"), "sign-in", "link")).toMatch(
      /Too many requests/,
    );
    expect(readableError(new Error("status 429"), "sign-in", "link")).toMatch(
      /Too many requests/,
    );
  });

  it("maps network failures", () => {
    expect(readableError(new Error("Failed to fetch"), "sign-in", "link")).toMatch(
      /couldn't reach the server/,
    );
    expect(readableError(new Error("network error"), "sign-in", "link")).toMatch(
      /couldn't reach the server/,
    );
  });

  it("maps an invalid email", () => {
    expect(
      readableError(new Error("Invalid email address"), "sign-in", "link"),
    ).toMatch(/email doesn't look right/);
  });

  it("uses mode-specific fallbacks for unknown errors", () => {
    expect(readableError(new Error("boom"), "sign-in", "link")).toMatch(
      /sign-in link/,
    );
    expect(readableError(new Error("boom"), "registration", "link")).toMatch(
      /verification link/,
    );
    // Non-Error values are stringified, not crashed on.
    expect(readableError(undefined, "sign-in", "link")).toMatch(/sign-in link/);
  });
});

describe("EMAIL_PATTERN", () => {
  it("accepts ordinary addresses and rejects malformed ones", () => {
    expect(EMAIL_PATTERN.test("you@company.com")).toBe(true);
    expect(EMAIL_PATTERN.test("no-at-sign")).toBe(false);
    expect(EMAIL_PATTERN.test("two@@company.com")).toBe(false);
    expect(EMAIL_PATTERN.test("spaces in@company.com")).toBe(false);
    expect(EMAIL_PATTERN.test("you@nodot")).toBe(false);
  });
});
