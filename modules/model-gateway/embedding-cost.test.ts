/**
 * modules/model-gateway/embedding-cost.test.ts — locks the embedding cost
 * attribution fix: embedding calls must be metered with a real USD cost, not a
 * hardcoded zero, so per-tenant/user cost totals include embeddings (OQ-10).
 */

import { describe, expect, it } from "vitest";
import {
  EMBEDDING_INPUT_COST_PER_1K_USD,
  estimateEmbeddingCostUsd,
} from "./service";

describe("estimateEmbeddingCostUsd", () => {
  it("charges the per-1k input rate (embeddings have no output tokens)", () => {
    expect(estimateEmbeddingCostUsd(1000)).toBeCloseTo(
      EMBEDDING_INPUT_COST_PER_1K_USD,
      10,
    );
    expect(estimateEmbeddingCostUsd(10_000)).toBeCloseTo(
      EMBEDDING_INPUT_COST_PER_1K_USD * 10,
      10,
    );
  });

  it("returns a non-zero cost for a realistic batch (was hardwired to 0)", () => {
    expect(estimateEmbeddingCostUsd(50_000)).toBeGreaterThan(0);
  });

  it("costs a zero-token call at zero", () => {
    expect(estimateEmbeddingCostUsd(0)).toBe(0);
  });

  it("rounds to the model_usage numeric(10,5) scale", () => {
    const cost = estimateEmbeddingCostUsd(1234);
    const decimals = (cost.toString().split(".")[1] ?? "").length;
    expect(decimals).toBeLessThanOrEqual(5);
  });
});
