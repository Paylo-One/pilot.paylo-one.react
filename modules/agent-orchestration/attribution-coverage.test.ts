/**
 * modules/agent-orchestration/attribution-coverage.test.ts — locks the
 * grounding roll-up that makes the memo/extraction trust contract measurable
 * (2026-07-20 ADR follow-up: "surface the drop-rate as a quality signal").
 * Pure aggregation only — no database.
 */

import { describe, expect, it } from "vitest";
import {
  summarizeAttributionCoverage,
  type CoverageRow,
} from "./attribution-coverage";

const META = { windowDays: 30, since: "2026-06-25T00:00:00.000Z", truncated: false };

describe("summarizeAttributionCoverage", () => {
  it("returns a fully-grounded, empty summary for no rows", () => {
    const s = summarizeAttributionCoverage([], META);
    expect(s.kept).toBe(0);
    expect(s.withheld).toBe(0);
    // Nothing produced ⇒ nothing withheld ⇒ perfect grounding, no false alarm.
    expect(s.coverageRate).toBe(1);
    expect(s.byAgent).toEqual([]);
    expect(s.windowDays).toBe(30);
    expect(s.truncated).toBe(false);
  });

  it("counts extraction survivors as kept and dropped as withheld", () => {
    const rows: CoverageRow[] = [
      {
        action: "pipeline.decision_extraction.run",
        metadata: { extracted: 3, droppedUnattributed: 1 },
      },
      {
        action: "pipeline.risk_detection.run",
        metadata: { extracted: 2, droppedUnattributed: 2 },
      },
      {
        action: "pipeline.action_extraction.run",
        metadata: { extracted: 4, droppedUnattributed: 0 },
      },
    ];
    const s = summarizeAttributionCoverage(rows, META);
    expect(s.kept).toBe(9);
    expect(s.withheld).toBe(3);
    expect(s.coverageRate).toBe(0.75);
    // Most-withheld agent first.
    expect(s.byAgent[0]).toEqual({ agent: "Risks", kept: 2, withheld: 2 });
  });

  it("excludes the appended external-signals section from briefing kept count", () => {
    // sections=4 includes 1 external-signals section; 3 model sections kept.
    const rows: CoverageRow[] = [
      {
        action: "briefing.generated",
        metadata: {
          sections: 4,
          externalSignals: 5,
          actions: 2,
          droppedSections: 1,
          droppedActions: 1,
        },
      },
    ];
    const s = summarizeAttributionCoverage(rows, META);
    // kept = (4 sections - 1 news) + 2 actions = 5; withheld = 1 + 1 = 2.
    expect(s.kept).toBe(5);
    expect(s.withheld).toBe(2);
    expect(s.byAgent).toEqual([{ agent: "Briefing", kept: 5, withheld: 2 }]);
  });

  it("treats a briefing with no external signals as all-model sections", () => {
    const rows: CoverageRow[] = [
      {
        action: "briefing.generated",
        metadata: { sections: 3, externalSignals: 0, actions: 1 },
      },
    ];
    const s = summarizeAttributionCoverage(rows, META);
    // No news section to subtract; no dropped keys ⇒ withheld 0.
    expect(s.kept).toBe(4);
    expect(s.withheld).toBe(0);
    expect(s.coverageRate).toBe(1);
  });

  it("ignores unrelated audit actions", () => {
    const rows: CoverageRow[] = [
      { action: "prompt.version.activated", metadata: { foo: 9 } },
      { action: "pipeline.decision_extraction.run", metadata: { extracted: 1, droppedUnattributed: 1 } },
    ];
    const s = summarizeAttributionCoverage(rows, META);
    expect(s.kept).toBe(1);
    expect(s.withheld).toBe(1);
    expect(s.coverageRate).toBe(0.5);
    expect(s.byAgent).toHaveLength(1);
  });

  it("coerces missing, null, and string-encoded counts safely", () => {
    const rows: CoverageRow[] = [
      { action: "pipeline.action_extraction.run", metadata: null },
      {
        action: "pipeline.risk_detection.run",
        metadata: { extracted: "2", droppedUnattributed: "1" },
      },
      { action: "pipeline.decision_extraction.run", metadata: { extracted: -5 } },
    ];
    const s = summarizeAttributionCoverage(rows, META);
    // null ⇒ 0/0; strings parsed ⇒ 2/1; negative ⇒ 0.
    expect(s.kept).toBe(2);
    expect(s.withheld).toBe(1);
  });

  it("merges multiple rows for the same agent", () => {
    const rows: CoverageRow[] = [
      { action: "pipeline.action_extraction.run", metadata: { extracted: 2, droppedUnattributed: 1 } },
      { action: "pipeline.action_extraction.run", metadata: { extracted: 3, droppedUnattributed: 0 } },
    ];
    const s = summarizeAttributionCoverage(rows, META);
    expect(s.byAgent).toEqual([
      { agent: "Suggested actions", kept: 5, withheld: 1 },
    ]);
  });

  it("propagates the truncated flag", () => {
    const s = summarizeAttributionCoverage([], { ...META, truncated: true });
    expect(s.truncated).toBe(true);
  });
});
