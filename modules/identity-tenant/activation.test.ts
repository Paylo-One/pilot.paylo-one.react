import { describe, expect, it } from "vitest";
import { isActivationToken } from "./activation";

describe("isActivationToken", () => {
  it("accepts a 32-byte base64url token", () => {
    expect(
      isActivationToken("abcdefghijklmnopqrstuvwxyzABCDEFGH123456789"),
    ).toBe(true);
  });

  it("rejects malformed, short, and padded tokens", () => {
    expect(isActivationToken("too-short")).toBe(false);
    expect(
      isActivationToken("abcdefghijklmnopqrstuvwxyzABCDEFGH12345678="),
    ).toBe(false);
    expect(
      isActivationToken("abcdefghijklmnopqrstuvwxyzABCDEFGH12345678+"),
    ).toBe(false);
  });
});
