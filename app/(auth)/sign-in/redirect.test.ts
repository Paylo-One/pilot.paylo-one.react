import { describe, expect, it } from "vitest";
import { magicLinkRedirectUrl, safeNextPath } from "@/lib/auth-redirect";

describe("magicLinkRedirectUrl", () => {
  it("preserves a prepared-tenant activation path", () => {
    expect(
      magicLinkRedirectUrl(
        "https://app.paylo.one",
        "/activate/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
      ),
    ).toBe(
      "https://app.paylo.one/auth/confirm?next=%2Factivate%2FabcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
    );
  });

  it("threads a referral code through the link so onboarding can recover it", () => {
    expect(
      magicLinkRedirectUrl("https://app.paylo.one", "/onboarding", "ABC123"),
    ).toBe(
      "https://app.paylo.one/auth/confirm?next=%2Fonboarding%3Fref%3DABC123",
    );
    // Decoding `next` once (as /auth/confirm does) yields the recoverable path.
    expect(
      decodeURIComponent("%2Fonboarding%3Fref%3DABC123"),
    ).toBe("/onboarding?ref=ABC123");
  });

  it("appends a referral code to an existing query string", () => {
    expect(
      magicLinkRedirectUrl("https://app.paylo.one", "/onboarding?step=profile", "ABC123"),
    ).toBe(
      "https://app.paylo.one/auth/confirm?next=%2Fonboarding%3Fstep%3Dprofile%26ref%3DABC123",
    );
  });

  it("omits ref when no referral code is supplied", () => {
    expect(magicLinkRedirectUrl("https://app.paylo.one", "/onboarding")).toBe(
      "https://app.paylo.one/auth/confirm?next=%2Fonboarding",
    );
  });

  it("falls back for external and protocol-relative destinations", () => {
    expect(
      magicLinkRedirectUrl("https://app.paylo.one", "https://example.com"),
    ).toBe("https://app.paylo.one/auth/confirm?next=%2Fonboarding");
    expect(magicLinkRedirectUrl("https://app.paylo.one", "//example.com")).toBe(
      "https://app.paylo.one/auth/confirm?next=%2Fonboarding",
    );
  });

  it("sanitises callback destinations independently", () => {
    expect(safeNextPath("/activate/valid-token")).toBe("/activate/valid-token");
    expect(safeNextPath("//example.com")).toBe("/onboarding");
    expect(safeNextPath("https://example.com")).toBe("/onboarding");
    expect(safeNextPath("/\\\\example.com/phish")).toBe("/onboarding");
    expect(safeNextPath("not a URL")).toBe("/onboarding");
  });
});
