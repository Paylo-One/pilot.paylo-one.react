/**
 * Locale configuration: the single source of supported languages and the
 * resolution/formatting helpers everything else derives from.
 */

import { describe, expect, it } from "vitest";
import {
  locales,
  defaultLocale,
  localeConfig,
  isLocale,
  resolveLocale,
  formatLocaleFor,
} from "@/i18n/config";

describe("locale config", () => {
  it("declares the seven required Pilot languages", () => {
    expect([...locales].sort()).toEqual(["da", "de", "en", "es", "fr", "nl", "no"]);
  });

  it("uses English as the default (source of truth) locale", () => {
    expect(defaultLocale).toBe("en");
    expect(locales).toContain(defaultLocale);
  });

  it("has complete metadata for every locale", () => {
    for (const loc of locales) {
      const meta = localeConfig[loc];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.englishName.length).toBeGreaterThan(0);
      expect(meta.formatLocale).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
      expect(meta.dir).toBe("ltr");
      expect(meta.currency).toBe("EUR");
    }
  });

  it("maps Norwegian to the nb-NO format tag", () => {
    expect(localeConfig.no.formatLocale).toBe("nb-NO");
    expect(formatLocaleFor("no")).toBe("nb-NO");
  });

  describe("isLocale", () => {
    it("accepts supported locales", () => {
      expect(isLocale("de")).toBe(true);
      expect(isLocale("en")).toBe(true);
    });
    it("rejects anything else", () => {
      expect(isLocale("xx")).toBe(false);
      expect(isLocale("EN")).toBe(false);
      expect(isLocale(undefined)).toBe(false);
      expect(isLocale(null)).toBe(false);
      expect(isLocale("")).toBe(false);
    });
  });

  describe("resolveLocale", () => {
    it("passes through supported locales", () => {
      expect(resolveLocale("fr")).toBe("fr");
    });
    it("coerces unknown/empty to English", () => {
      expect(resolveLocale("xx")).toBe("en");
      expect(resolveLocale(undefined)).toBe("en");
      expect(resolveLocale(null)).toBe("en");
    });
  });

  describe("formatLocaleFor", () => {
    it("falls back to the English format tag for unknown locales", () => {
      expect(formatLocaleFor("xx")).toBe("en-GB");
    });
  });
});
