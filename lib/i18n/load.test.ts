/**
 * Message loading + English per-key fallback (ADR-052). English is the
 * guaranteed fallback: any key missing from a draft locale must transparently
 * render its English string, and unknown locales must coerce to English.
 */

import { afterEach, describe, expect, it } from "vitest";
import { loadMessages, __clearMessageCache } from "@/i18n/load";
import { locales } from "@/i18n/config";

/** Recursively collect the leaf key paths of a message tree. */
function keyPaths(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return [prefix];
  }
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

afterEach(() => __clearMessageCache());

describe("loadMessages", () => {
  it("loads the full English message tree", () => {
    const en = loadMessages("en");
    // The namespaces localised in this change must all be present.
    for (const ns of ["shared", "common", "nav", "shell", "settings", "auth"]) {
      expect(en[ns], `missing namespace ${ns}`).toBeDefined();
    }
  });

  it("guarantees every English key is resolvable in every locale (fallback)", () => {
    const enKeys = new Set(keyPaths(loadMessages("en")));
    for (const loc of locales) {
      const locKeys = new Set(keyPaths(loadMessages(loc)));
      const missing = [...enKeys].filter((k) => !locKeys.has(k));
      expect(missing, `locale ${loc} is missing keys: ${missing.slice(0, 5).join(", ")}`).toEqual([]);
    }
  });

  it("coerces an unknown locale to the English tree", () => {
    expect(loadMessages("xx")).toEqual(loadMessages("en"));
  });

  it("memoises per locale (same reference on repeat load)", () => {
    const a = loadMessages("de");
    const b = loadMessages("de");
    expect(a).toBe(b);
  });
});
