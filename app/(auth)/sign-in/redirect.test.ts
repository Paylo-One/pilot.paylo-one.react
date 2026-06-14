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
  });
});
