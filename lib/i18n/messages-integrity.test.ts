/**
 * Message-catalogue integrity (ADR-052 governance check). This is the guard
 * that keeps translations honest as they are added/edited:
 *   - the message folders on disk match the supported-locale list exactly;
 *   - every locale ships the same namespace files as English;
 *   - every file is valid JSON;
 *   - no translated string introduces an ICU placeholder that English does not
 *     define (an undefined `{var}` would render as literal text or throw).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { locales, defaultLocale } from "@/i18n/config";

const MESSAGES_DIR = join(process.cwd(), "messages");

function localeDirs(): string[] {
  return readdirSync(MESSAGES_DIR).filter((f) => {
    try {
      return statSync(join(MESSAGES_DIR, f)).isDirectory();
    } catch {
      return false;
    }
  });
}

function namespaceFiles(locale: string): string[] {
  return readdirSync(join(MESSAGES_DIR, locale))
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .sort();
}

function read(locale: string, file: string): unknown {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, locale, file), "utf8"));
}

/** All `{placeholder}` tokens in a message tree, keyed by leaf path. */
function placeholdersByPath(obj: unknown, prefix = "", out: Record<string, Set<string>> = {}): Record<string, Set<string>> {
  if (typeof obj === "string") {
    const vars = new Set<string>();
    // Match the leading identifier of an ICU token: {name} or {name, plural,…}.
    for (const m of obj.matchAll(/\{\s*([a-zA-Z0-9_]+)/g)) {
      if (m[1]) vars.add(m[1]);
    }
    out[prefix] = vars;
    return out;
  }
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      placeholdersByPath(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

describe("message catalogue integrity", () => {
  it("has exactly one message folder per supported locale", () => {
    expect(localeDirs().sort()).toEqual([...locales].sort());
  });

  it("ships the same namespace files in every locale as English", () => {
    const enFiles = namespaceFiles(defaultLocale);
    for (const loc of locales) {
      expect(namespaceFiles(loc), `locale ${loc} namespace files differ`).toEqual(enFiles);
    }
  });

  it("has valid JSON in every locale file", () => {
    for (const loc of locales) {
      for (const file of namespaceFiles(loc)) {
        expect(() => read(loc, file), `${loc}/${file} is not valid JSON`).not.toThrow();
      }
    }
  });

  it("introduces no ICU placeholder that English does not define", () => {
    for (const file of namespaceFiles(defaultLocale)) {
      const en = placeholdersByPath(read(defaultLocale, file));
      for (const loc of locales) {
        if (loc === defaultLocale) continue;
        const loc_ = placeholdersByPath(read(loc, file));
        for (const [path, vars] of Object.entries(loc_)) {
          const allowed = en[path] ?? new Set<string>();
          const extra = [...vars].filter((v) => !allowed.has(v));
          expect(extra, `${loc}/${file} @ ${path} has undefined placeholders: ${extra.join(", ")}`).toEqual([]);
        }
      }
    }
  });
});
