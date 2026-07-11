# Tenant-Isolation / RLS Audit — Pilot app

> **Date:** 2026-07-11
> **Auditor:** Pleco (Paylo One stewardship agent)
> **Scope:** All 46 SQL migrations in `supabase/migrations/` (103 `public` tables). Static review of RLS enablement and policy predicates. **Read-only — no schema change made.**
> **Related:** governance risk **R-03**, open question **OQ-11**, `governance/assessment/2026-07-11-initial-platform-assessment.md`.
> **Categories:** Fact (verified in-migration), Recommendation.

## Verdict

**Schema-level multi-tenant isolation is production-grade.** Every `public` table has RLS enabled and every tenant-scoped policy reviewed keys off the canonical `auth_tenant_ids()` helper. No unscoped tenant policy, no disabled RLS, and no `public`-role read path was found. The remaining work is **verification (automated tests + CI lint), not construction** — so OQ-11 ("how much RLS/isolation work is needed") can be downgraded from *needs investigation* to *foundation complete; add enforcement tests*.

## What was checked (Fact)

**Foundation** (`20260607160001_tenancy_core.sql`)
- `public.auth_tenant_ids()` is `SECURITY DEFINER`, `stable`, `set search_path = ''`, and reads `tenant_users` by `auth.uid()`. Execute is revoked from `public`, granted only to `authenticated`/`service_role`. This is the correct hardened pattern.
- Grants are explicit per table (no blanket auto-expose). Core tables (`tenants`, `tenant_users`, `tenant_domains`, `user_profiles`) have RLS + member-scoped or self-scoped read; writes go through `service_role`.

**RLS coverage: 103 / 103 public tables.**
- 85 tables enable RLS with explicit `alter table … enable row level security`.
- The remaining 18 (admin, catalogue, billing, subscription/usage tables) enable RLS via **dynamic `do $$ … execute format('alter table %I enable row level security') … $$` loops** in `20260613180000_admin_foundation.sql`, `20260613200000_billing_subscriptions.sql`, and `20260621144559_stripe_managed_billing.sql`. (These are why a naive grep under-counts — noted so future audits don't misread it.)
- `20260624045122_remote_schema.sql` adds `passkey_credentials` (self-scoped by `auth.uid()`) and a defensive loop re-asserting RLS. No table there drops a policy or disables RLS.

**Policy scoping (representative sample explicitly verified):**
| Table | Predicate | Scope |
|---|---|---|
| `people`, `briefings`, `source_items`, `news_item`, `news_tenant_preferences`, `whatsapp_messages`, `decisions`, `knowledge_embeddings` | `tenant_id in (select public.auth_tenant_ids())` | Tenant |
| `diary_entries` | `tenant_id in auth_tenant_ids() AND author_user_id = auth.uid()` | Tenant **and** author (private diary) |
| `user_profiles`, `passkey_credentials` | `user_id = auth.uid()` | Self |
| `admin_*`, `billing_admin_notes`, `billing_audit_log` | `public.is_platform_admin()` | Platform admin only |
| `billing_customers`, `billing_subscriptions`, `billing_access`, `tenant_subscriptions`, `tenant_entitlement_overrides`, `subscription_discounts`, `usage_counters` | member: `tenant_id in auth_tenant_ids()`; admin: `is_platform_admin()` | Tenant + admin |
| `catalogue_items`, `catalogue_prices`, `subscription_plans` | `visibility='public' and is_enabled` / `is_public` (+ admin) | Intentional public catalogue |

**Secret-bearing tables are server-only** (RLS on, **no** `authenticated`/`anon` grant → only `service_role` (BYPASSRLS) can touch them): `integration_credentials`, `tenant_model_providers`, `whatsapp_session_material`, `billing_events`. Verified.

**Write path:** tenant tables generally define **no** `authenticated` write policy — with RLS default-deny this means direct client writes are blocked and all mutations flow through `service_role` server actions. This is a deliberate, safe posture (documented in the admin/billing migration comments).

## Findings

- **No cross-tenant read exposure found.** The only `using (true)` policy in the entire migration set is on `news_provider` — a global provider catalogue holding no tenant data and no secrets (the migration comment explicitly keeps API keys out of the table). RLS is enabled there only because Supabase exposes `public` tables via PostgREST. **Not a vulnerability.**
- **No `disable row level security` anywhere. No `to public` read policies.**

## Recommendations (Recommendation)

1. **[High] Add automated tenant-isolation tests.** No such tests exist today; correctness currently rests on manual review. Add a Vitest suite that authenticates as a member of tenant A and asserts **zero** rows returned from tenant B across a representative table set (`people`, `decisions`, `briefings`, `source_items`, `diary_entries`, `whatsapp_messages`, `billing_subscriptions`), plus the reverse. This converts "correct by inspection" into "enforced in CI" and guards against regressions.
2. **[Medium] Add an RLS lint gate to CI.** Because RLS is applied manually per migration (partly via dynamic loops), a future table could ship without it. Run `supabase db lint` / the RLS linter in CI to fail on any `public` table without RLS.
3. **[Low] Consider `force row level security`** on the most sensitive tenant tables (diary, people, knowledge_embeddings) for defence-in-depth against a non-`service_role` table owner. (`service_role` intentionally retains BYPASSRLS.)
4. **[Doc] Record the "writes via service_role only" convention** in a short data-access README so contributors don't add `authenticated` write policies by habit.

## Out of scope (flagged for later cycles)

- **Server-side key handling:** RLS is only half the story — confirm the Supabase secret/service key is used exclusively server-side and never reaches the client bundle. Recommended as the next security cycle.
- **Admin portal** (`pilot-admin`) is a separate Supabase-federated surface with its own tables/roles; it warrants its own isolation + least-privilege audit (tracked as R-04).
