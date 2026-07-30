import { describe, expect, it } from "vitest";
import {
  ACTION_DEDUPE,
  candidateEmbeddingText,
  classifyActionMatch,
} from "./dedupe";

describe("classifyActionMatch", () => {
  it("enriches at or above the enrich threshold", () => {
    expect(classifyActionMatch(ACTION_DEDUPE.enrichThreshold)).toBe("enrich");
    expect(classifyActionMatch(0.99)).toBe("enrich");
  });

  it("flags the uncertain band for review, never silent merging", () => {
    expect(classifyActionMatch(ACTION_DEDUPE.reviewThreshold)).toBe("review");
    expect(classifyActionMatch(ACTION_DEDUPE.enrichThreshold - 0.001)).toBe("review");
  });

  it("treats weak matches as distinct", () => {
    expect(classifyActionMatch(ACTION_DEDUPE.reviewThreshold - 0.001)).toBe("distinct");
    expect(classifyActionMatch(0)).toBe("distinct");
  });

  it("treats missing or invalid similarity as distinct", () => {
    expect(classifyActionMatch(null)).toBe("distinct");
    expect(classifyActionMatch(undefined)).toBe("distinct");
    expect(classifyActionMatch(Number.NaN)).toBe("distinct");
  });

  it("keeps the threshold ordering sane", () => {
    expect(ACTION_DEDUPE.enrichThreshold).toBeGreaterThan(ACTION_DEDUPE.reviewThreshold);
    expect(ACTION_DEDUPE.reviewThreshold).toBeGreaterThan(0.5);
  });
});

describe("candidateEmbeddingText", () => {
  it("mirrors the canonical action form used by semantic linking", () => {
    const text = candidateEmbeddingText({
      title: "Send the board pack",
      rationale: "Promised in Monday's call",
      dueAt: "2026-08-01T00:00:00Z",
    });
    expect(text).toContain("Type: action");
    expect(text).toContain("Label: Send the board pack");
    expect(text).toContain("Rationale: Promised in Monday's call");
    expect(text).toContain("Due: 2026-08-01T00:00:00Z");
  });

  it("omits absent fields instead of emitting empty lines", () => {
    const text = candidateEmbeddingText({ title: "Send the board pack" });
    expect(text).not.toContain("Rationale:");
    expect(text).not.toContain("Due:");
  });
});
