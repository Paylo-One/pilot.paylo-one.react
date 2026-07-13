#!/usr/bin/env node
/**
 * Sync the `shared` message namespace across the pilot and marketing repos
 * (ADR-046 shared-terminology model). The marketing repo owns the canonical
 * `messages/<locale>/shared.json` (product name, tagline, nav labels, common
 * CTAs, glossary terms); this copies it into the pilot so both apps render
 * identical terminology without a shared package or monorepo.
 *
 * Usage:
 *   node scripts/sync-shared-messages.mjs            # copy source → dest
 *   node scripts/sync-shared-messages.mjs --check    # exit 1 if they differ (CI)
 *   node scripts/sync-shared-messages.mjs --from <dir> --to <dir>
 *
 * Defaults assume the two repos are siblings on disk (as they are cloned under
 * ~/Paylo-One). In CI, run --check where both repos are checked out; each
 * repo's own vendored copy is still validated by i18n-check.mjs.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const siblings = resolve(repoRoot, "..");
const MARKETING = resolve(siblings, "pilot-marketing.paylo-one.react", "messages");
const PILOT = resolve(siblings, "pilot.paylo-one.react", "messages");

const from = resolve(arg("--from", MARKETING));
const to = resolve(arg("--to", PILOT));
const NS = "shared.json";

if (!existsSync(from)) {
  console.error(`Source messages dir not found: ${from}`);
  process.exit(2);
}

const locales = readdirSync(from).filter((d) => existsSync(join(from, d, NS)));
let drift = 0;

for (const locale of locales) {
  const src = join(from, locale, NS);
  const dst = join(to, locale, NS);
  const srcContent = readFileSync(src, "utf8");

  if (CHECK) {
    if (!existsSync(dst) || readFileSync(dst, "utf8") !== srcContent) {
      console.error(`✖ shared drift: ${locale}/${NS} differs (or missing) in ${to}`);
      drift++;
    }
    continue;
  }

  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, srcContent);
  console.log(`synced ${locale}/${NS} → ${dst}`);
}

if (CHECK) {
  if (drift) {
    console.error(`\n✖ ${drift} shared namespace file(s) out of sync. Run: node scripts/sync-shared-messages.mjs`);
    process.exit(1);
  }
  console.log("✓ shared terminology in sync.");
}
