import { describe, expect, it } from "vitest";
import {
  canonicalKnowledgeText,
  contentHashFor,
  relationshipTypeFor,
  scoreSemanticCandidate,
} from "./service";

describe("semantic-linking pure helpers", () => {
  it("builds stable canonical text and hashes equivalent whitespace consistently", () => {
    const a = canonicalKnowledgeText({
      entityType: "person",
      label: "  Ada   Lovelace ",
      fields: [" Role:  Founder  ", "", null, "Notes: Analytical engine"],
    });
    const b = canonicalKnowledgeText({
      entityType: "person",
      label: "Ada Lovelace",
      fields: ["Role: Founder", "Notes: Analytical engine"],
    });

    expect(a).toEqual(b);
    expect(contentHashFor(a)).toEqual(contentHashFor(b));
  });

  it("boosts high-signal entity pairs without exceeding the score cap", () => {
    expect(
      scoreSemanticCandidate({
        sourceType: "person",
        targetType: "company",
        similarity: 0.74,
      }),
    ).toBe(0.82);
    expect(
      scoreSemanticCandidate({
        sourceType: "source_item",
        targetType: "source_item",
        similarity: 0.98,
      }),
    ).toBe(0.94);
  });

  it("chooses explainable relationship kinds for common semantic pairs", () => {
    expect(relationshipTypeFor("action", "person")).toBe("action_owner");
    expect(relationshipTypeFor("diary_entry", "person")).toBe("mentioned_with");
    expect(relationshipTypeFor("company", "person")).toBe("semantically_related");
  });
});
