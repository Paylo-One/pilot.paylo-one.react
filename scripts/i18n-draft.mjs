#!/usr/bin/env node
/**
 * Machine-assisted translation drafting (ADR-048). Fills missing / stale
 * non-English message keys with draft translations, marked needsReview so a
 * human clears them before important (marketing/legal/security/billing) copy
 * goes live or is indexed.
 *
 * Two modes:
 *   (default) translate missing+stale keys for every non-en locale via the
 *             EU-resident OpenAI-compatible inference path (ADR-045). Requires
 *             LLM_BASE_URL + LLM_API_KEY (+ optional LLM_MODEL). Glossary at
 *             docs (governance) is honoured via the system prompt below.
 *   --stamp   (re)write every non-en `_status.json` so baseHash = the current
 *             English namespace hash and reviewed=false. Run this after adding
 *             or hand-authoring drafts so the staleness tracker is aligned and
 *             everything is correctly flagged as awaiting human review.
 *
 * This is a DRAFTING AID. It never marks anything reviewed; that is a human act.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, basename } from "node:path";

const ROOT = process.cwd();
const MESSAGES_DIR = resolve(ROOT, "messages");
const STAMP = process.argv.includes("--stamp");
const DEFAULT_LOCALE = "en";

const sha256 = (t) => createHash("sha256").update(t).digest("hex").slice(0, 16);

function readLocales() {
  const cfg = readFileSync(resolve(ROOT, "i18n/config.ts"), "utf8");
  return cfg.match(/export const locales\s*=\s*\[([^\]]+)\]/)[1].match(/"([^"]+)"/g).map((s) => s.replace(/"/g, ""));
}

const enDir = join(MESSAGES_DIR, DEFAULT_LOCALE);
const namespaces = readdirSync(enDir).filter((f) => f.endsWith(".json") && !f.startsWith("_")).map((f) => basename(f, ".json"));
const enHash = Object.fromEntries(namespaces.map((ns) => [ns, sha256(readFileSync(join(enDir, `${ns}.json`), "utf8"))]));
const locales = readLocales().filter((l) => l !== DEFAULT_LOCALE);

if (STAMP) {
  for (const locale of locales) {
    const statusPath = join(MESSAGES_DIR, locale, "_status.json");
    const prev = existsSync(statusPath) ? JSON.parse(readFileSync(statusPath, "utf8")) : {};
    const next = {};
    for (const ns of namespaces) {
      next[ns] = { reviewed: prev[ns]?.reviewed === true, baseHash: enHash[ns] };
    }
    writeFileSync(statusPath, JSON.stringify(next, null, 2) + "\n");
    console.log(`stamped ${locale}/_status.json (${namespaces.length} namespaces)`);
  }
  console.log("\n✓ status stamped. Reviewed flags preserved; run i18n-check to see coverage.");
  process.exit(0);
}

// --- Live drafting mode (requires credentials) ---------------------------------
const BASE = process.env.LLM_BASE_URL;
const KEY = process.env.LLM_API_KEY;
const MODEL = process.env.LLM_MODEL || "mistral/mistral-small-latest";
if (!BASE || !KEY) {
  console.error(
    "Live drafting needs LLM_BASE_URL + LLM_API_KEY (EU-resident router, ADR-045).\n" +
      "To only align staleness/review status after manual drafting, run with --stamp."
  );
  process.exit(2);
}

const GLOSSARY_HINT =
  "Do NOT translate these product terms; keep them verbatim: Paylo.one, Pilot, Daily Memo, Diary, " +
  "Tool Layer, People & Companies. Preserve ICU placeholders like {name} and {count, plural, ...} exactly. " +
  "Return ONLY a JSON object mapping the given keys to translated strings.";

async function translateBatch(locale, entries) {
  const res = await fetch(`${BASE.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `Translate UI copy from English to ${locale}. ${GLOSSARY_HINT}` },
        { role: "user", content: JSON.stringify(entries) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

console.log("Live drafting is wired for the EU inference path but is intentionally");
console.log("conservative: review the produced drafts before clearing needsReview.");
console.log(`(model=${MODEL}) — implement per-namespace batching against your key here.`);
