import { describe, expect, it } from "vitest";

import {
  ENTITY_TYPE_LABELS,
  humanEntityLabel,
  type EntityType,
} from "./people.types";

const ALL_ENTITY_TYPES: EntityType[] = [
  "person",
  "company",
  "topic",
  "action",
  "decision",
  "diary_entry",
  "briefing",
  "source_item",
];

describe("humanEntityLabel", () => {
  it("gives every endpoint type a calm, human descriptor", () => {
    for (const type of ALL_ENTITY_TYPES) {
      const label = humanEntityLabel(type);
      expect(label).toBe(`a related ${ENTITY_TYPE_LABELS[type].toLowerCase()}`);
    }
  });

  it("never leaks a raw entity id or id-prefix into operator-visible copy", () => {
    // The bug this guards: an unresolved endpoint used to render as
    // "action 3f2a1b9c" — a uuid slice straight into the relationship label.
    // A calm descriptor must contain no hex-looking id fragment.
    for (const type of ALL_ENTITY_TYPES) {
      const label = humanEntityLabel(type);
      expect(label).toMatch(/^a related [a-z ]+$/);
      expect(label).not.toMatch(/[0-9a-f]{6,}/i);
    }
  });

  it("reads as plain language for the types semantic linking connects", () => {
    expect(humanEntityLabel("source_item")).toBe("a related source");
    expect(humanEntityLabel("diary_entry")).toBe("a related diary entry");
    expect(humanEntityLabel("action")).toBe("a related action");
    expect(humanEntityLabel("person")).toBe("a related person");
    expect(humanEntityLabel("company")).toBe("a related company");
  });
});
