import { describe, expect, it } from "vitest";
import {
  buildSemanticEvidence,
  canonicalKnowledgeText,
  contentHashFor,
  humanEntityLabel,
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

  it("never leaks a raw entity id in the fallback label for an unresolved neighbour", () => {
    for (const type of ["person", "company", "action", "diary_entry", "source_item"]) {
      const label = humanEntityLabel(type);
      // Human, calm, and free of hex id fragments / underscores.
      expect(label).toMatch(/^a related [a-z ]+$/);
      expect(label).not.toMatch(/[0-9a-f]{6}/);
    }
    expect(humanEntityLabel("unknown_type")).toBe("a related item");
  });

  it("builds operator-facing evidence with a rounded percentage and both labels", () => {
    expect(buildSemanticEvidence("Ada Lovelace", "Analytical Engine Ltd", 0.837)).toBe(
      "Ada Lovelace and Analytical Engine Ltd are semantically close (84% vector similarity).",
    );
    // Fallback label flows through cleanly — still no id leak.
    const evidence = buildSemanticEvidence("Ada Lovelace", humanEntityLabel("company"), 0.9);
    expect(evidence).toContain("a related company");
    expect(evidence).not.toMatch(/[0-9a-f]{6}/);
  });
});
