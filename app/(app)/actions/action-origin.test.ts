import { describe, expect, it } from "vitest";
import { actionOrigin } from "./action-origin";

describe("actionOrigin", () => {
  it("preserves the supported briefing handoff origin", () => {
    expect(actionOrigin("briefing")).toBe("briefing");
  });

  it.each([undefined, null, "suggestion", "email", {}, 1])(
    "defaults an untrusted value to manual: %j",
    (value) => expect(actionOrigin(value)).toBe("manual"),
  );
});
