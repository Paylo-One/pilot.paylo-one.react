import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { metadata } from "./page";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("InviteAcceptancePage", () => {
  it("does not imply that an existing link can create workspace membership", () => {
    expect(metadata.title).toBe("Invitation unavailable · Paylo.one");
    expect(source).toContain("This invitation is not available yet");
    expect(source).toContain("cannot add you to a workspace");
    expect(source).not.toContain("Create my passkey");
  });

  it("offers recovery paths without reflecting the bearer token", () => {
    expect(source).toContain('href="/request-access"');
    expect(source).toContain('href="/sign-in"');
    expect(source).not.toContain("searchParams");
  });
});
