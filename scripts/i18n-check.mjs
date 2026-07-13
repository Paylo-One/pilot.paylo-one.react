#!/usr/bin/env node
/**
 * i18n governance check (ADR-048). Repo-agnostic: run from a repo root that has
 * `messages/<locale>/<namespace>.json` and `i18n/config.ts`.
 *
 * Detects and reports:
 *   - missing keys       (present in English source, absent in a locale)      ERROR
 *   - obsolete keys      (present in a locale, no longer in English)          ERROR
 *   - invalid locale files (unparseable JSON)                                 ERROR
 *   - placeholder drift  (ICU `{var}` set differs from the English message)   ERROR
 *   - stale namespaces   (English changed since the locale was aligned)       WARN
 *   - unreviewed namespaces (machine drafts not yet human-approved)           WARN
 *
 * Emits `messages/coverage.json` — per locale/namespace coverage %, reviewed,
 * stale — consumed by the marketing SEO indexing guard and the docs.
 *
 * Exit codes: non-zero if any ERROR. `--strict` also fails on WARN.
 *
 * English (`en`) is the source of truth: its key set defines the universe and
 * it is always considered complete + reviewed. Per-locale review + staleness
 * state lives in `messages/<locale>/_status.json`:
 *   { "<namespace>": { "reviewed": true, "baseHash": "<sha256 of en ns file>" } }
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, basename } from "node:path";

const ROOT = process.cwd();
const MESSAGES_DIR = resolve(ROOT, "messages");
const STRICT = process.argv.includes("--strict");
// Locales are read from i18n/config.ts without importing TS: parse the array.
const DEFAULT_LOCALE = "en";

function readLocales() {
  const cfg = readFileSync(resolve(ROOT, "i18n/config.ts"), "utf8");
  const m = cfg.match(/export const locales\s*=\s*\[([^\]]+)\]/);
  if (!m) throw new Error("Could not parse `locales` from i18n/config.ts");
  return m[1].match(/"([^"]+)"/g).map((s) => s.replace(/"/g, ""));
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Flatten nested objects/arrays into dot/index paths → string leaves. */
function flatten(obj, prefix = "", out = {}) {
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => flatten(v, prefix ? `${prefix}.${i}` : String(i), out));
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else {
    out[prefix] = obj;
  }
  return out;
}

/** ICU placeholder variable names used in a message, e.g. {count, plural,...} → count. */
function placeholders(value) {
  if (typeof value !== "string") return new Set();
  const set = new Set();
  const re = /\{\s*([a-zA-Z0-9_]+)\s*[,}]/g;
  let m;
  while ((m = re.exec(value))) set.add(m[1]);
  return set;
}

function namespacesFor(locale) {
  const dir = join(MESSAGES_DIR, locale);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => basename(f, ".json"));
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const locales = readLocales();
const errors = [];
const warnings = [];
const coverage = {};

// English source: hash each namespace file + flatten its keys.
const enDir = join(MESSAGES_DIR, DEFAULT_LOCALE);
const enNamespaces = namespacesFor(DEFAULT_LOCALE);
const enFlat = {};
const enHash = {};
for (const ns of enNamespaces) {
  const path = join(enDir, `${ns}.json`);
  const raw = readFileSync(path, "utf8");
  enHash[ns] = sha256(raw);
  try {
    enFlat[ns] = flatten(JSON.parse(raw));
  } catch (e) {
    errors.push(`en/${ns}.json: invalid JSON — ${e.message}`);
    enFlat[ns] = {};
  }
}

for (const locale of locales) {
  coverage[locale] = {};
  if (locale === DEFAULT_LOCALE) {
    for (const ns of enNamespaces) {
      const total = Object.keys(enFlat[ns]).length;
      coverage[locale][ns] = { total, translated: total, pct: 100, reviewed: true, stale: false };
    }
    continue;
  }

  const statusPath = join(MESSAGES_DIR, locale, "_status.json");
  const status = existsSync(statusPath) ? loadJson(statusPath) : {};

  for (const ns of enNamespaces) {
    const total = Object.keys(enFlat[ns]).length;
    const path = join(MESSAGES_DIR, locale, `${ns}.json`);
    const nsStatus = status[ns] || {};
    const reviewed = nsStatus.reviewed === true;
    const stale = nsStatus.baseHash !== enHash[ns];

    if (!existsSync(path)) {
      errors.push(`${locale}/${ns}.json: missing file (English has ${total} keys)`);
      coverage[locale][ns] = { total, translated: 0, pct: 0, reviewed: false, stale: true };
      continue;
    }

    let flat;
    try {
      flat = flatten(loadJson(path));
    } catch (e) {
      errors.push(`${locale}/${ns}.json: invalid JSON — ${e.message}`);
      coverage[locale][ns] = { total, translated: 0, pct: 0, reviewed: false, stale: true };
      continue;
    }

    const enKeys = new Set(Object.keys(enFlat[ns]));
    const locKeys = new Set(Object.keys(flat));
    const missing = [...enKeys].filter((k) => !locKeys.has(k) || flat[k] === "");
    const obsolete = [...locKeys].filter((k) => !enKeys.has(k));

    // A REVIEWED namespace must be complete (it is treated as production copy and
    // may be indexed). An unreviewed (draft) namespace may be partial — English
    // fallback covers the gaps at runtime and it is kept out of indexing — so
    // missing keys are only a warning until a human marks the namespace reviewed.
    for (const k of missing) {
      const msg = `${locale}/${ns}: missing key "${k}"`;
      if (reviewed) errors.push(msg + " (namespace is marked reviewed → must be complete)");
      else warnings.push(msg + " (draft; English fallback in use)");
    }
    // Obsolete keys and placeholder drift are always errors: they are cruft or
    // will break ICU formatting regardless of review state.
    for (const k of obsolete) errors.push(`${locale}/${ns}: obsolete key "${k}" (not in English)`);

    for (const k of enKeys) {
      if (!locKeys.has(k)) continue;
      const a = placeholders(enFlat[ns][k]);
      const b = placeholders(flat[k]);
      const diff = [...a].filter((x) => !b.has(x)).concat([...b].filter((x) => !a.has(x)));
      if (diff.length) errors.push(`${locale}/${ns}: placeholder drift on "${k}" (${[...a]} vs ${[...b]})`);
    }

    if (stale) warnings.push(`${locale}/${ns}: stale — English changed since last aligned (re-draft + review)`);
    if (!reviewed) warnings.push(`${locale}/${ns}: not human-reviewed (needsReview)`);

    const translated = [...enKeys].filter((k) => locKeys.has(k) && flat[k] !== "").length;
    coverage[locale][ns] = {
      total,
      translated,
      pct: total ? Math.round((translated / total) * 100) : 100,
      reviewed,
      stale,
    };
  }
}

writeFileSync(join(MESSAGES_DIR, "coverage.json"), JSON.stringify(coverage, null, 2) + "\n");

const line = (s) => process.stdout.write(s + "\n");
line("");
line("i18n coverage:");
for (const locale of locales) {
  const nss = coverage[locale];
  const totals = Object.values(nss).reduce(
    (a, c) => ({ t: a.t + c.total, x: a.x + c.translated }),
    { t: 0, x: 0 }
  );
  const pct = totals.t ? Math.round((totals.x / totals.t) * 100) : 100;
  const unreviewed = Object.values(nss).filter((c) => !c.reviewed).length;
  const stale = Object.values(nss).filter((c) => c.stale).length;
  line(`  ${locale.padEnd(3)} ${String(pct).padStart(3)}%  (${unreviewed} ns need review, ${stale} stale)`);
}
line("");

if (warnings.length) {
  line(`⚠ ${warnings.length} warning(s):`);
  warnings.slice(0, 40).forEach((w) => line("  - " + w));
  if (warnings.length > 40) line(`  … and ${warnings.length - 40} more`);
  line("");
}
if (errors.length) {
  line(`✖ ${errors.length} error(s):`);
  errors.slice(0, 60).forEach((e) => line("  - " + e));
  if (errors.length > 60) line(`  … and ${errors.length - 60} more`);
  line("");
  process.exit(1);
}
if (STRICT && warnings.length) {
  line("✖ --strict: warnings treated as errors.");
  process.exit(1);
}
line("✓ i18n check passed.");
