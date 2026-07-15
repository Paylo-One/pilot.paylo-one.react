/**
 * modules/model-usage-cost/summarize.test.ts — locks the usage/cost roll-up
 * that surfaces spend to operators (OQ-10). The metering write path was fixed
 * on 2026-07-14; this covers the read/aggregation side now displayed in
 * Settings. Pure aggregation only — no database.
 */

import { describe, expect, it } from "vitest";
import { summarizeUsageRows, type RawUsageRow } from "./index";

const META = { windowDays: 30, since: "2026-06-15T00:00:00.000Z", truncated: false };

describe("summarizeUsageRows", () => {
  it("returns a zeroed summary for no rows", () => {
    const s = summarizeUsageRows([], META);
    expect(s.calls).toBe(0);
    expect(s.totalTokens).toBe(0);
    expect(s.estCostUsd).toBe(0);
    expect(s.failedCalls).toBe(0);
    expect(s.byModel).toEqual([]);
    expect(s.windowDays).toBe(30);
    expect(s.since).toBe(META.since);
  });

  it("sums tokens and cost across calls", () => {
    const rows: RawUsageRow[] = [
      { model: "gpt-x", input_tokens: 100, output_tokens: 50, total_tokens: 150, est_cost_usd: "0.00300", status: "ok" },
      { model: "gpt-x", input_tokens: 200, output_tokens: 100, total_tokens: 300, est_cost_usd: "0.00600", status: "ok" },
    ];
    const s = summarizeUsageRows(rows, META);
    expect(s.calls).toBe(2);
    expect(s.inputTokens).toBe(300);
    expect(s.outputTokens).toBe(150);
    expect(s.totalTokens).toBe(450);
    expect(s.estCostUsd).toBeCloseTo(0.009, 6);
  });

  it("parses string-encoded numeric cost (PostgREST serialises numeric as text)", () => {
    const rows: RawUsageRow[] = [
      { model: "m", input_tokens: 1, output_tokens: 1, total_tokens: 2, est_cost_usd: "0.12345", status: "ok" },
    ];
    expect(summarizeUsageRows(rows, META).estCostUsd).toBeCloseTo(0.12345, 6);
  });

  it("falls back to input+output when total_tokens is null", () => {
    const rows: RawUsageRow[] = [
      { model: "m", input_tokens: 40, output_tokens: 10, total_tokens: null, est_cost_usd: null, status: "ok" },
    ];
    const s = summarizeUsageRows(rows, META);
    expect(s.totalTokens).toBe(50);
    expect(s.estCostUsd).toBe(0);
  });

  it("counts failed calls but still meters their tokens/cost", () => {
    const rows: RawUsageRow[] = [
      { model: "m", input_tokens: 10, output_tokens: 0, total_tokens: 10, est_cost_usd: "0.001", status: "failed" },
      { model: "m", input_tokens: 10, output_tokens: 5, total_tokens: 15, est_cost_usd: "0.002", status: "ok" },
    ];
    const s = summarizeUsageRows(rows, META);
    expect(s.failedCalls).toBe(1);
    expect(s.calls).toBe(2);
    expect(s.totalTokens).toBe(25);
  });

  it("breaks down by model, ordered by cost descending", () => {
    const rows: RawUsageRow[] = [
      { model: "cheap", input_tokens: 10, output_tokens: 10, total_tokens: 20, est_cost_usd: "0.001", status: "ok" },
      { model: "pricey", input_tokens: 10, output_tokens: 10, total_tokens: 20, est_cost_usd: "0.050", status: "ok" },
      { model: "pricey", input_tokens: 10, output_tokens: 10, total_tokens: 20, est_cost_usd: "0.050", status: "ok" },
    ];
    const s = summarizeUsageRows(rows, META);
    expect(s.byModel.map((m) => m.modelId)).toEqual(["pricey", "cheap"]);
    const [pricey] = s.byModel;
    expect(pricey?.calls).toBe(2);
    expect(pricey?.estCostUsd).toBeCloseTo(0.1, 6);
  });

  it("buckets rows with a null model under 'unknown'", () => {
    const rows: RawUsageRow[] = [
      { model: null, input_tokens: 5, output_tokens: 5, total_tokens: 10, est_cost_usd: "0.001", status: "ok" },
    ];
    expect(summarizeUsageRows(rows, META).byModel[0]?.modelId).toBe("unknown");
  });

  it("propagates the truncated flag", () => {
    expect(summarizeUsageRows([], { ...META, truncated: true }).truncated).toBe(true);
  });
});
