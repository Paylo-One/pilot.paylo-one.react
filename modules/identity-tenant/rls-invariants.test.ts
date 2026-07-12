/**
 * modules/identity-tenant/rls-invariants.test.ts
 *
 * Static tenant-isolation invariants over the Supabase migration set. This is
 * the executable form of the 2026-07-11 RLS audit
 * (`docs/security/2026-07-11-tenant-isolation-rls-audit.md`) and the audit's
 * recommended CI lint gate: it fails the build if a future migration weakens
 * the multi-tenant isolation guarantees.
 *
 * IMPORTANT: this verifies **policy coverage in the schema**, not runtime
 * enforcement. True runtime RLS behaviour (tenant A cannot read tenant B) is
 * covered by `tenant-isolation.integration.test.ts`, which requires a live test
 * database. These static checks are the cheap, always-on regression guard.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Concatenate every migration into one lowercased, whitespace-collapsed blob. */
function loadSql(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const raw = files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8")).join("\n");
  return raw.toLowerCase().replace(/\s+/g, " ");
}

const SQL = loadSql();

/** All tables created in the public schema. */
function createdTables(): Set<string> {
  const set = new Set<string>();
  const re = /create table (?:if not exists )?(?:public\.)?([a-z_][a-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SQL))) {
    const name = m[1];
    if (!name) continue;
    // `create table x as ...` and CTE noise: the only real tables all live in
    // `public.` — but guard against the odd keyword capture anyway.
    if (name === "as" || name === "select") continue;
    set.add(name);
  }
  return set;
}

/** Tables with RLS enabled via a static `alter table ... enable row level security`. */
function staticRlsEnabled(): Set<string> {
  const set = new Set<string>();
  const re = /alter table (?:only )?(?:public\.)?([a-z_][a-z0-9_]*) enable row level security/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SQL))) if (m[1]) set.add(m[1]);
  return set;
}

/**
 * Tables with RLS enabled via a dynamic `foreach t in array array[...] loop
 * ... enable row level security ... end loop` block (used by the admin/billing
 * migrations). We collect the array identifiers of any loop whose body enables
 * RLS.
 */
function loopRlsEnabled(): Set<string> {
  const set = new Set<string>();
  const loopRe = /foreach\s+\w+\s+in\s+array\s+array\s*\[([^\]]*)\]\s*loop(.*?)end loop/g;
  let m: RegExpExecArray | null;
  while ((m = loopRe.exec(SQL))) {
    const arrayLiteral = m[1] ?? "";
    const body = m[2] ?? "";
    if (!/enable row level security/.test(body)) continue;
    const idRe = /'([a-z_][a-z0-9_]*)'/g;
    let id: RegExpExecArray | null;
    while ((id = idRe.exec(arrayLiteral))) if (id[1]) set.add(id[1]);
  }
  return set;
}

/** Tables whose `create table` body declares a `tenant_id` column. */
function tenantScopedTables(): Set<string> {
  const set = new Set<string>();
  // Split on create-table boundaries and inspect each block up to the next one.
  const re = /create table (?:if not exists )?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([^;]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SQL))) {
    const name = m[1];
    const body = m[2] ?? "";
    if (name && /\btenant_id\b/.test(body)) set.add(name);
  }
  return set;
}

/** Every `using (true)` policy, paired with the table it targets. */
function usingTruePolicies(): string[] {
  const tables: string[] = [];
  const re = /create policy [a-z_][a-z0-9_]* on (?:public\.)?([a-z_][a-z0-9_]*)[^;]*?using \(\s*true\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SQL))) if (m[1]) tables.push(m[1]);
  return tables;
}

describe("RLS invariants (static schema audit)", () => {
  it("parses a plausible number of tables (guards against a broken parser)", () => {
    expect(createdTables().size).toBeGreaterThanOrEqual(90);
  });

  it("parsers are non-vacuous (a broken regex must fail loudly, not silently pass)", () => {
    // If any of these parsers silently returned empty, the isolation checks
    // below would pass vacuously. Anchor them to known ground truth from the
    // audit so a future refactor that breaks a regex fails here first.
    expect(loopRlsEnabled(), "loop-RLS parser found no tables").toContain("billing_customers");
    expect(loopRlsEnabled()).toContain("admin_users");
    expect(tenantScopedTables().size).toBeGreaterThanOrEqual(20);
    for (const t of ["people", "decisions", "diary_entries"]) {
      expect(tenantScopedTables(), `expected ${t} to be tenant-scoped`).toContain(t);
    }
    // The one intentional global-catalogue using(true) must still be detected.
    expect(usingTruePolicies()).toContain("news_provider");
  });

  it("never disables row level security", () => {
    expect(SQL).not.toMatch(/disable row level security/);
  });

  it("defines no policy granting read to the `public` role", () => {
    // Reads must be gated to `authenticated`/`anon`, never the catch-all
    // `public` role which would bypass auth entirely.
    expect(SQL).not.toMatch(/for select to public\b/);
    expect(SQL).not.toMatch(/to public using/);
  });

  it("enables RLS on every table in the public schema", () => {
    const enabled = new Set<string>([...staticRlsEnabled(), ...loopRlsEnabled()]);
    const missing = [...createdTables()].filter((t) => !enabled.has(t)).sort();
    expect(missing, `tables created without RLS enabled: ${missing.join(", ")}`).toEqual([]);
  });

  it("only allows `using (true)` on non-tenant reference tables", () => {
    // A `using (true)` policy is world-readable to the granted role. That is
    // only ever acceptable on a shared reference table with NO tenant_id column
    // (e.g. the global `news_provider` catalogue). On a tenant-scoped table it
    // would be a cross-tenant data leak.
    const tenantTables = tenantScopedTables();
    const offenders = usingTruePolicies().filter((t) => tenantTables.has(t));
    expect(
      offenders,
      `tenant-scoped tables with an unscoped using(true) policy: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
