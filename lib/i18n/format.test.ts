/**
 * Locale-aware value formatting. The point of these helpers is that the SAME
 * value renders differently per locale (separators, currency placement, month
 * names) — driven by each locale's `formatLocale`, never a hard-coded "en-GB".
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  formatDate,
  formatNumber,
  formatCurrency,
  formatPercent,
  formatRelativeTime,
  __clearFormatterCache,
} from "@/lib/i18n/format";

afterEach(() => __clearFormatterCache());

describe("formatNumber", () => {
  it("uses locale-specific grouping/decimal separators", () => {
    // English: 1,234,567.89 — German: 1.234.567,89 — French: narrow-NBSP groups.
    expect(formatNumber("en", 1234567.89)).toBe("1,234,567.89");
    expect(formatNumber("de", 1234567.89)).toBe("1.234.567,89");
    expect(formatNumber("de", 1234567.89)).not.toBe(formatNumber("en", 1234567.89));
  });
});

describe("formatCurrency", () => {
  it("defaults to the locale's EUR and places the symbol per locale", () => {
    const en = formatCurrency("en", 49);
    const de = formatCurrency("de", 49);
    expect(en).toContain("49");
    expect(en).toContain("€");
    // German places the symbol after the amount; English before it.
    expect(de).toMatch(/49,00\s*€/);
    expect(en).not.toBe(de);
  });

  it("honours an explicit currency override", () => {
    expect(formatCurrency("en", 10, "USD")).toContain("$");
  });
});

describe("formatPercent", () => {
  it("formats a ratio as a locale percentage", () => {
    expect(formatPercent("en", 0.42)).toBe("42%");
  });
});

describe("formatDate", () => {
  it("localises month/weekday names", () => {
    const value = new Date("2026-07-14T10:00:00Z");
    const en = formatDate("en", value, { day: "numeric", month: "long" });
    const de = formatDate("de", value, { day: "numeric", month: "long" });
    expect(en).toContain("July");
    expect(de).toContain("Juli");
  });
});

describe("formatRelativeTime", () => {
  it("produces locale-appropriate relative phrasing", () => {
    const now = new Date("2026-07-14T12:00:00Z");
    const inThreeDays = new Date("2026-07-17T12:00:00Z");
    expect(formatRelativeTime("en", inThreeDays, now)).toMatch(/3 days/);
    const twoHoursAgo = new Date("2026-07-14T10:00:00Z");
    expect(formatRelativeTime("en", twoHoursAgo, now)).toMatch(/2 hours ago/);
  });
});
