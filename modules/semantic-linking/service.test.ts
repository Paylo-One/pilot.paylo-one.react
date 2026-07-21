import { describe, expect, it } from "vitest";
import {
  canonicalKnowledgeText,
  contentHashFor,
  isSuggestiblePair,
  minScoreFor,
  relationshipTypeFor,
  scoreSemanticCandidate,
  SEMANTIC_LINK_MIN_SCORE,
  SEMANTIC_LINK_MIN_SCORE_SAME_TYPE,
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

  it("never suggests message↔message or person↔person semantic pairs", () => {
    expect(isSuggestiblePair("source_item", "source_item")).toBe(false);
    expect(isSuggestiblePair("source_item", "person")).toBe(false);
    expect(isSuggestiblePair("person", "person")).toBe(false);
    expect(
      scoreSemanticCandidate({
        sourceType: "source_item",
        targetType: "source_item",
        similarity: 1,
      }),
    ).toBe(0);
  });

  it("allows explainable cross-type pairs above the threshold, no boosts", () => {
    expect(isSuggestiblePair("person", "company")).toBe(true);
    expect(
      scoreSemanticCandidate({
        sourceType: "person",
        targetType: "company",
        similarity: 0.9,
      }),
    ).toBe(0.9);
    // Below threshold → no suggestion, regardless of pair type.
    expect(
      scoreSemanticCandidate({
        sourceType: "person",
        targetType: "company",
        similarity: SEMANTIC_LINK_MIN_SCORE - 0.01,
      }),
    ).toBe(0);
  });

  it("holds same-type pairs to a stricter bar than cross-type pairs", () => {
    expect(minScoreFor("action", "action")).toBe(SEMANTIC_LINK_MIN_SCORE_SAME_TYPE);
    expect(minScoreFor("person", "action")).toBe(SEMANTIC_LINK_MIN_SCORE);
    expect(
      scoreSemanticCandidate({
        sourceType: "action",
        targetType: "action",
        similarity: 0.88,
      }),
    ).toBe(0);
    expect(
      scoreSemanticCandidate({
        sourceType: "action",
        targetType: "action",
        similarity: 0.95,
      }),
    ).toBe(0.95);
  });

  it("chooses explainable relationship kinds for common semantic pairs", () => {
    expect(relationshipTypeFor("action", "person")).toBe("action_owner");
    expect(relationshipTypeFor("diary_entry", "person")).toBe("mentioned_with");
    expect(relationshipTypeFor("company", "person")).toBe("semantically_related");
  });
});
