# ADR-052 — Pilot application internationalisation (i18n)

- **Status:** Proposed (pilot-local; to be reconciled into the governance
  decision log `docs/decisions/architecture-decisions.md`).
- **Date:** 2026-07-14
- **Context tags:** frontend, model-gateway, security, data-model
- **Relates to:** ADR-046 (marketing-site i18n), ADR-045 (EU inference).

## Context

Pilot must operate in seven languages — English, Dutch, German, French,
Norwegian, Danish, Spanish — across the authenticated application (shell,
navigation, onboarding, settings, forms, empty/error/system states) and its
AI-assisted experiences. A prior change (PR #14) added next-intl scaffolding but
left it **unwired** (the provider was imported into `app/layout.tsx` but never
applied), no persistence, no selector, and effectively all UI text hard-coded.

The pilot differs from the marketing site (ADR-046) in one decisive way: it
routes **tenants** by subdomain and is authenticated and non-indexed. A
URL-prefix locale strategy (`/de/…`) would collide with tenant routing and add
no SEO value. The locale must therefore be a **per-user preference**, not a URL
segment.

## Decision

1. **next-intl in no-URL-routing mode.** Locale is resolved per request in
   `i18n/request.ts` with precedence: `NEXT_LOCALE` cookie → `Accept-Language`
   → English.
2. **`i18n/config.ts` is the single source of supported languages** (id, endonym
   label, BCP-47 `formatLocale`, direction, currency). Everything derives from
   it. English is the source of truth and guaranteed fallback.
3. **English per-key fallback by deep-merge** (`i18n/load.ts`): non-English
   catalogues are merged onto English, so a missing key renders English, never a
   raw key.
4. **Persistence at the user level:** `user_profiles.locale` (nullable, CHECK-
   constrained to the supported set). Mirrored into an **apex-scoped**
   `NEXT_LOCALE` cookie (shared across tenant subdomains, like the auth cookie)
   and re-seeded from the profile on every login, so the choice follows the user
   across sessions and devices.
5. **A single consistent language selector** — an accessible native `<select>`
   rendering endonyms (never flags). It calls one server action
   (`setLocaleAction`) that sets the cookie and persists the profile.
6. **Locale-aware formatting** via `lib/i18n/format.ts` (thin `Intl` wrappers
   keyed off `formatLocale`). Hard-coded `toLocale*("en-GB")` usage is removed as
   surfaces are migrated.
7. **AI execution context receives the user's language** (§8) at the Model
   Gateway boundary (`service.invoke`) — covering all gateway callers — and at
   the direct-SDK call sites for prose output.
8. **Safety (§9):** the injected language is always a fixed English endonym from
   `localeConfig`, never raw input; the directive is a static, tenant-agnostic
   sentence appended *after* the tenant system prompt (cannot override
   safety/role instructions), and instructs the model to preserve names,
   identifiers and source references verbatim. Data classification and routing
   are unaffected; structured/JSON-metadata calls stay English.

## Consequences

- Adding a language is a content task: extend `i18n/config.ts`, add the CHECK
  value in a migration, and drop in `messages/<locale>/*.json`.
- A catalogue-integrity test enforces that every locale has the same namespaces,
  valid JSON, and no undefined ICU placeholders.
- Non-English catalogues are **machine-drafted and require native review** before
  production sign-off (`messages/_translation-status.json`).
- Remaining feature-surface string extraction (briefing/actions/diary/people/
  companies/sources/prompts/intelligence/mcp/billing detail screens and
  server-action error strings) is tracked as follow-up; the framework, patterns,
  and tests make it mechanical.

## Alternatives considered

- **URL-prefixed locales** (as marketing): rejected — collides with tenant
  subdomain routing; no SEO benefit on an authenticated app.
- **Client-only translation / browser MT:** rejected — inconsistent, leaks
  layout bugs, no server-rendered correctness, weak accessibility.
