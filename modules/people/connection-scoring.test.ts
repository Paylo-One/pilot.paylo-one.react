import { describe, expect, it } from "vitest";
import {
  CONNECTION_SCORING,
  recencyFactor,
  scoreConnection,
  tierForConfidence,
  type ConnectionEvidence,
  type ConnectionSignal,
} from "./connection-scoring";

const NOW = new Date("2026-07-21T12:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function evidence(...signals: ConnectionSignal[]): ConnectionEvidence {
  return { signals };
}

describe("connection scoring", () => {
  it("ranks a strong multi-signal relationship as strong", () => {
    const result = scoreConnection(
      evidence(
        {
          kind: "direct_interaction",
          count: 24,
          lastAt: daysAgo(2),
          detail: "Exchanged 24 Teams messages in the past 90 days.",
        },
        {
          kind: "co_occurrence",
          count: 12,
          lastAt: daysAgo(5),
          detail: "Appeared together in 12 conversations.",
        },
        { kind: "shared_company", detail: "Both linked to Zeam Ltd." },
      ),
      NOW,
    );
    expect(result.tier).toBe("strong");
    expect(result.relationshipType).toBe("collaborates_with");
    expect(result.headline).toContain("24 Teams messages");
  });

  it("never lets a semantic-only match rise above possible, and hides weak ones", () => {
    const high = scoreConnection(
      evidence({
        kind: "semantic_profile",
        similarity: 0.99,
        detail: "Their profiles read very similar.",
      }),
      NOW,
    );
    // Semantic similarity alone: capped, and with no countable events → hidden.
    expect(high.tier).toBe("hidden");

    const weak = scoreConnection(
      evidence({
        kind: "semantic_profile",
        similarity: 0.9,
        detail: "Their profiles read similar.",
      }),
      NOW,
    );
    expect(weak.tier).toBe("hidden");
  });

  it("contributes nothing for semantic similarity below the floor", () => {
    const below = scoreConnection(
      evidence(
        { kind: "shared_company", detail: "Both linked to Paytec." },
        { kind: "semantic_profile", similarity: CONNECTION_SCORING.semanticFloor - 0.01, detail: "…" },
      ),
      NOW,
    );
    const withoutSemantic = scoreConnection(
      evidence({ kind: "shared_company", detail: "Both linked to Paytec." }),
      NOW,
    );
    expect(below.score).toBe(withoutSemantic.score);
  });

  it("hides a single-event co-occurrence (insufficient evidence)", () => {
    const result = scoreConnection(
      evidence({
        kind: "co_occurrence",
        count: 1,
        lastAt: daysAgo(1),
        detail: "Appeared together in 1 conversation.",
      }),
      NOW,
    );
    expect(result.tier).toBe("hidden");
  });

  it("keeps a shared company visible even without interaction counts", () => {
    const result = scoreConnection(
      evidence({ kind: "shared_company", detail: "Both linked to Zeam Ltd." }),
      NOW,
    );
    expect(result.tier).toBe("possible");
    expect(result.relationshipType).toBe("same_company");
  });

  it("decays stale evidence: old-only interaction scores below recent interaction", () => {
    const recent = scoreConnection(
      evidence({
        kind: "direct_interaction",
        count: 10,
        lastAt: daysAgo(3),
        detail: "Exchanged 10 messages.",
      }),
      NOW,
    );
    const stale = scoreConnection(
      evidence({
        kind: "direct_interaction",
        count: 10,
        lastAt: daysAgo(365),
        detail: "Exchanged 10 messages.",
      }),
      NOW,
    );
    expect(stale.score).toBeLessThan(recent.score);
    expect(stale.tier).toBe("hidden");
  });

  it("applies diminishing returns: 10× the messages does not mean 10× the score", () => {
    const base = scoreConnection(
      evidence({ kind: "direct_interaction", count: 10, lastAt: daysAgo(1), detail: "…" }),
      NOW,
    );
    const flood = scoreConnection(
      evidence({ kind: "direct_interaction", count: 100, lastAt: daysAgo(1), detail: "…" }),
      NOW,
    );
    expect(flood.score).toBeGreaterThan(base.score);
    expect(flood.score).toBeLessThan(base.score * 2);
  });

  it("treats an explicit operator-recorded relationship as visible structural evidence", () => {
    const result = scoreConnection(
      evidence({ kind: "explicit", detail: "You linked them as collaborators." }),
      NOW,
    );
    expect(result.tier).not.toBe("hidden");
  });

  it("is deterministic: same evidence and clock produce the same result", () => {
    const input = evidence(
      { kind: "direct_interaction", count: 7, lastAt: daysAgo(10), detail: "…" },
      { kind: "shared_company", detail: "Both at Paytec." },
    );
    const a = scoreConnection(input, NOW);
    const b = scoreConnection(input, NOW);
    expect(a).toEqual(b);
  });

  it("orders tiers consistently: more evidence never yields a lower score", () => {
    const one = scoreConnection(
      evidence({ kind: "co_occurrence", count: 4, lastAt: daysAgo(2), detail: "…" }),
      NOW,
    );
    const more = scoreConnection(
      evidence(
        { kind: "co_occurrence", count: 4, lastAt: daysAgo(2), detail: "…" },
        { kind: "direct_interaction", count: 4, lastAt: daysAgo(2), detail: "…" },
      ),
      NOW,
    );
    expect(more.score).toBeGreaterThan(one.score);
  });

  it("picks explainable relationship kinds from the dominant evidence", () => {
    expect(
      scoreConnection(
        evidence({ kind: "direct_interaction", count: 9, lastAt: daysAgo(1), detail: "…" }),
        NOW,
      ).relationshipType,
    ).toBe("frequent_correspondent");
    expect(
      scoreConnection(
        evidence({ kind: "co_occurrence", count: 9, lastAt: daysAgo(1), detail: "…" }),
        NOW,
      ).relationshipType,
    ).toBe("mentioned_with");
  });

  it("maps stored confidences onto tiers for legacy rows", () => {
    expect(tierForConfidence(0.9)).toBe("strong");
    expect(tierForConfidence(0.3)).toBe("relevant");
    expect(tierForConfidence(0.15)).toBe("possible");
    expect(tierForConfidence(0.05)).toBe("hidden");
  });

  it("computes recency factors on a half-life curve", () => {
    expect(recencyFactor(daysAgo(0), NOW)).toBeCloseTo(1, 5);
    expect(recencyFactor(daysAgo(CONNECTION_SCORING.halfLifeDays), NOW)).toBeCloseTo(0.5, 5);
    expect(recencyFactor(undefined, NOW)).toBe(1);
  });
});
