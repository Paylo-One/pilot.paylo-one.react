import { describe, expect, it } from "vitest";

import { observedIdentityFromItem } from "./correlation";

describe("observedIdentityFromItem", () => {
  it("recognises Slack and Discord authors for people correlation", () => {
    expect(
      observedIdentityFromItem({
        id: "s1",
        system: "slack",
        title: null,
        body: "hello",
        author: "U123",
        occurredAt: null,
      }),
    ).toEqual({ type: "slack", value: "U123" });

    expect(
      observedIdentityFromItem({
        id: "d1",
        system: "discord",
        title: null,
        body: "hello",
        author: "bernard",
        occurredAt: null,
      }),
    ).toEqual({ type: "discord", value: "bernard" });
  });
});
