import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const briefingSource = readFileSync(new URL("../briefing/page.tsx", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../settings/page.tsx", import.meta.url), "utf8");
const navigationSource = readFileSync(
  new URL("../../../components/workspace-nav.tsx", import.meta.url),
  "utf8",
);

describe("InvitationsPage", () => {
  it("presents invitation issuance as paused without a copy control", () => {
    expect(source).toContain("Invitations are paused");
    expect(source).toContain("membership before issuing new links");
    expect(source).not.toContain("CopyLinkButton");
    expect(source).not.toContain("referralService");
  });

  it("keeps issuance controls out of every previously advertised surface", () => {
    expect(briefingSource).not.toContain("InvitationStrip");
    expect(briefingSource).not.toContain("referralService.getOverview");
    expect(settingsSource).not.toContain("CopyLinkButton");
    expect(settingsSource).not.toContain("referralService.getOverview");
    expect(settingsSource).toContain('tag="planned"');
    expect(settingsSource).toContain("No new invitation links can be issued yet");
    expect(navigationSource).not.toContain('href: "/invitations"');
  });
});
