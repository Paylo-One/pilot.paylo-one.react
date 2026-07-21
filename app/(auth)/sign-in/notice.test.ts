import { describe, expect, it } from "vitest";
import { noticeFor } from "./notice";

describe("noticeFor", () => {
  it("shows an info notice for an existing account", () => {
    expect(noticeFor({ existing: "1" })).toEqual({
      tone: "info",
      message:
        "You already have an account. Sign in below to open your workspace.",
    });
  });

  it("prefers the existing notice over an error code", () => {
    expect(noticeFor({ existing: "1", error: "oauth_state" })?.tone).toBe("info");
  });

  it("explains not_a_member without leaking internals", () => {
    const notice = noticeFor({ error: "not_a_member" });
    expect(notice?.tone).toBe("warn");
    expect(notice?.message).toMatch(/isn't a member of that workspace/);
  });

  it("explains an OAuth state failure", () => {
    expect(noticeFor({ error: "oauth_state" })).toEqual({
      tone: "warn",
      message: "That sign-in couldn't be verified. Please start again.",
    });
  });

  it.each(["missing_code", "missing_token"])(
    "treats %s as an incomplete link",
    (code) => {
      expect(noticeFor({ error: code })).toEqual({
        tone: "warn",
        message: "That sign-in link was incomplete. Request a fresh one below.",
      });
    },
  );

  it.each([
    "Email link is invalid or has expired",
    "OTP_EXPIRED",
    "Invalid token",
  ])("maps raw provider message %j to the expired-link copy", (raw) => {
    const notice = noticeFor({ error: raw });
    expect(notice?.tone).toBe("warn");
    expect(notice?.message).toMatch(/link has expired/);
  });

  it("falls back to a generic warning for unknown errors", () => {
    expect(noticeFor({ error: "some_unknown_code" })).toEqual({
      tone: "warn",
      message: "Something interrupted that sign-in. Please try again below.",
    });
  });

  it("returns null when there is nothing to say", () => {
    expect(noticeFor({})).toBeNull();
    expect(noticeFor({ error: "" })).toBeNull();
  });
});
