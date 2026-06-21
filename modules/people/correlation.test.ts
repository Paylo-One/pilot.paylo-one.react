import { describe, expect, it } from "vitest";

import { detectDuplicatePeople, observedIdentityFromItem } from "./correlation";
import type { Person } from "./people.types";

function person(overrides: Partial<Person> & Pick<Person, "id" | "displayName">): Person {
  return {
    roleTitle: null,
    organisation: null,
    companyId: null,
    companyName: null,
    relationshipType: "other",
    importance: "normal",
    status: "active",
    emails: [],
    phones: [],
    tags: [],
    notes: null,
    identities: [],
    relationships: [],
    signals: [],
    linkedActions: [],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

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

describe("detectDuplicatePeople", () => {
  it("flags records sharing an identity value with high confidence", () => {
    const dups = detectDuplicatePeople([
      person({ id: "a", displayName: "Jacques Becker", emails: ["jacques@acme.com"] }),
      person({ id: "b", displayName: "J. Becker", emails: ["jacques@acme.com"] }),
    ]);
    expect(dups).toHaveLength(1);
    expect(dups[0]?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(dups[0]?.reason).toMatch(/share the identity/i);
  });

  it("flags identical names without a shared identity at lower confidence", () => {
    const dups = detectDuplicatePeople([
      person({ id: "a", displayName: "Priya Nair", emails: ["priya@one.com"] }),
      person({ id: "b", displayName: "Priya Nair", emails: ["priya@two.com"] }),
    ]);
    expect(dups).toHaveLength(1);
    expect(dups[0]?.confidence).toBeCloseTo(0.7);
  });

  it("does not flag clearly distinct people", () => {
    const dups = detectDuplicatePeople([
      person({ id: "a", displayName: "Randy Coburn", emails: ["randy@one.com"] }),
      person({ id: "b", displayName: "Priya Nair", emails: ["priya@two.com"] }),
    ]);
    expect(dups).toHaveLength(0);
  });

  it("sorts the strongest duplicate suggestions first", () => {
    const dups = detectDuplicatePeople([
      person({ id: "a", displayName: "Sam Lee", emails: ["sam@acme.com"] }),
      person({ id: "b", displayName: "Sam Lee", emails: ["sam2@acme.com"] }), // same name
      person({ id: "c", displayName: "Different Sam", emails: ["sam@acme.com"] }), // shared identity with a
    ]);
    expect(dups[0]?.confidence).toBeGreaterThanOrEqual(dups[1]?.confidence ?? 0);
  });
});
