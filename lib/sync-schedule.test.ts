/**
 * lib/sync-schedule.test.ts — unit tests for next-sync scheduling math (ADR-043).
 * All cases pass an explicit baseDate so they're deterministic.
 */

import { describe, expect, it } from "vitest";
import { calculateNextSyncAt } from "./sync-schedule";

/** Wall-clock "HH:MM" of an instant in a given IANA timezone. */
function localHM(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

describe("calculateNextSyncAt", () => {
  it("daily: schedules today's briefing time when the base is before it (UTC)", () => {
    const base = new Date("2026-06-16T05:00:00Z");
    const next = calculateNextSyncAt("daily", "UTC", "08:00:00", base);
    expect(next.toISOString()).toBe("2026-06-16T08:00:00.000Z");
  });

  it("daily: rolls to tomorrow when the base is past the briefing time (UTC)", () => {
    const base = new Date("2026-06-16T09:00:00Z");
    const next = calculateNextSyncAt("daily", "UTC", "08:00:00", base);
    expect(next.toISOString()).toBe("2026-06-17T08:00:00.000Z");
  });

  it("four_times_a_day: picks the nearest 6-hourly slot after the base (UTC)", () => {
    // Anchored at 08:00 → slots 08:00, 14:00, 20:00, 02:00(+1d). Base 09:00 → 14:00.
    const base = new Date("2026-06-16T09:00:00Z");
    const next = calculateNextSyncAt("four_times_a_day", "UTC", "08:00:00", base);
    expect(next.toISOString()).toBe("2026-06-16T14:00:00.000Z");
  });

  it("twice_a_day: picks the +12h slot after the base (UTC)", () => {
    // Slots 08:00, 20:00. Base 12:00 → 20:00.
    const base = new Date("2026-06-16T12:00:00Z");
    const next = calculateNextSyncAt("twice_a_day", "UTC", "08:00:00", base);
    expect(next.toISOString()).toBe("2026-06-16T20:00:00.000Z");
  });

  it("always returns an instant strictly after the base", () => {
    const base = new Date("2026-06-16T08:00:00Z");
    for (const freq of ["daily", "twice_a_day", "three_times_a_day", "four_times_a_day"]) {
      const next = calculateNextSyncAt(freq, "UTC", "08:00:00", base);
      expect(next.getTime()).toBeGreaterThan(base.getTime());
    }
  });

  it("falls back to UTC for an invalid timezone (does not throw)", () => {
    const base = new Date("2026-06-16T05:00:00Z");
    const next = calculateNextSyncAt("daily", "Not/AZone", "08:00:00", base);
    expect(next.toISOString()).toBe("2026-06-16T08:00:00.000Z");
  });

  it("is DST-safe: 08:00 local holds across BST and GMT in Europe/London", () => {
    // Summer (BST, UTC+1)
    const summerBase = new Date("2026-06-16T00:00:00Z");
    const summerNext = calculateNextSyncAt("daily", "Europe/London", "08:00:00", summerBase);
    expect(localHM(summerNext, "Europe/London")).toBe("08:00");

    // Winter (GMT, UTC+0)
    const winterBase = new Date("2026-01-16T00:00:00Z");
    const winterNext = calculateNextSyncAt("daily", "Europe/London", "08:00:00", winterBase);
    expect(localHM(winterNext, "Europe/London")).toBe("08:00");

    // The two must resolve to different UTC instants (the +1h offset shift).
    expect(summerNext.toISOString()).not.toBe(winterNext.toISOString());
  });

  it("accepts HH:MM (no seconds) and defaults a blank time to 08:00", () => {
    const base = new Date("2026-06-16T05:00:00Z");
    expect(calculateNextSyncAt("daily", "UTC", "06:30", base).toISOString()).toBe(
      "2026-06-16T06:30:00.000Z",
    );
    expect(calculateNextSyncAt("daily", "UTC", "", base).toISOString()).toBe(
      "2026-06-16T08:00:00.000Z",
    );
  });
});
