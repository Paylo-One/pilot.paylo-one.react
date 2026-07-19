/**
 * tz-day.test.ts — calendar-day reasoning must follow the operator's timezone,
 * not the (UTC) server. These cases pin the boundary behaviour that the Daily
 * Memo triage relies on.
 */

import { describe, expect, it } from "vitest";

import { calendarDayInTimeZone, hourInTimeZone } from "./tz-day";

describe("hourInTimeZone", () => {
  it("reads the wall-clock hour in the given zone, not UTC", () => {
    // 23:30 UTC is 01:30 the next day in Berlin (UTC+2 in July).
    const t = new Date("2026-07-17T23:30:00Z");
    expect(hourInTimeZone(t, "UTC")).toBe(23);
    expect(hourInTimeZone(t, "Europe/Berlin")).toBe(1);
    // 20:00 UTC is 13:00 in Los Angeles (UTC-7 in July) — afternoon, not evening.
    const afternoon = new Date("2026-07-17T20:00:00Z");
    expect(hourInTimeZone(afternoon, "America/Los_Angeles")).toBe(13);
  });

  it("normalises midnight to hour 0", () => {
    const midnight = new Date("2026-07-17T00:00:00Z");
    expect(hourInTimeZone(midnight, "UTC")).toBe(0);
  });

  it("falls back to UTC for an unknown timezone", () => {
    const t = new Date("2026-07-17T23:30:00Z");
    expect(hourInTimeZone(t, "Not/AZone")).toBe(23);
  });
});

describe("calendarDayInTimeZone", () => {
  it("encodes the local calendar day as YYYYMMDD", () => {
    const t = new Date("2026-07-17T12:00:00Z");
    expect(calendarDayInTimeZone(t, "UTC")).toBe(20260717);
  });

  it("rolls to the next/previous day at the zone's midnight, not UTC's", () => {
    // 23:30 UTC on the 17th is already the 18th in Berlin...
    const lateUtc = new Date("2026-07-17T23:30:00Z");
    expect(calendarDayInTimeZone(lateUtc, "UTC")).toBe(20260717);
    expect(calendarDayInTimeZone(lateUtc, "Europe/Berlin")).toBe(20260718);
    // ...and 02:00 UTC on the 18th is still the 17th in Los Angeles.
    const earlyUtc = new Date("2026-07-18T02:00:00Z");
    expect(calendarDayInTimeZone(earlyUtc, "America/Los_Angeles")).toBe(20260717);
  });

  it("compares monotonically across a month boundary", () => {
    const jul31 = calendarDayInTimeZone(new Date("2026-07-31T12:00:00Z"), "UTC");
    const aug01 = calendarDayInTimeZone(new Date("2026-08-01T12:00:00Z"), "UTC");
    expect(jul31).toBeLessThan(aug01);
  });

  it("compares monotonically across a year boundary", () => {
    const dec31 = calendarDayInTimeZone(new Date("2026-12-31T12:00:00Z"), "UTC");
    const jan01 = calendarDayInTimeZone(new Date("2027-01-01T12:00:00Z"), "UTC");
    expect(dec31).toBeLessThan(jan01);
  });
});
