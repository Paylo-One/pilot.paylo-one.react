import { describe, expect, it } from "vitest";
import { actionOrigin, actionOriginLabel } from "./action-origin";

describe("actionOrigin", () => {
  it("preserves the supported briefing handoff origin", () => {
    expect(actionOrigin("briefing")).toBe("briefing");
  });

  it.each([undefined, null, "suggestion", "email", {}, 1])(
    "defaults an untrusted value to manual: %j",
    (value) => expect(actionOrigin(value)).toBe("manual"),
  );
});

describe("actionOriginLabel", () => {
  it.each([
    ["manual", "Manually captured"],
    ["briefing", "Confirmed from Daily briefing"],
    ["suggestion", "Suggested by Pilot"],
    ["diary", "Created from diary"],
    ["meeting", "Extracted from meeting"],
    ["email", "Extracted from email"],
    ["people", "Created from People"],
  ])("presents %s provenance honestly", (origin, label) => {
    expect(actionOriginLabel(origin)).toBe(label);
  });

  it.each([undefined, null, "invented", {}, 1])(
    "does not claim automation for an unknown origin: %j",
    (value) => expect(actionOriginLabel(value)).toBe("Origin unavailable"),
  );
});
