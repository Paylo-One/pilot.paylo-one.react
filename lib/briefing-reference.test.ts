import { describe, expect, it } from "vitest";
import { formatBriefingReferenceTime } from "./briefing-reference";

describe("formatBriefingReferenceTime", () => {
  it("uses the operator timezone for source evidence", () => {
    expect(
      formatBriefingReferenceTime(
        "2026-08-13T05:15:00.000Z",
        "Europe/Amsterdam",
      ),
    ).toBe("13 Aug, 07:15");
  });

  it("omits absent or invalid evidence timestamps", () => {
    expect(formatBriefingReferenceTime(null, "UTC")).toBeNull();
    expect(formatBriefingReferenceTime("not-a-date", "UTC")).toBeNull();
  });
});
