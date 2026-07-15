# Localisation (i18n) — Pilot application

Pilot ships in **seven languages**: English (source), Dutch, German, French,
Norwegian, Danish and Spanish. This document is the practical guide for adding
and translating strings. The architectural decision is ADR-052
(`docs/adr/ADR-052-app-i18n.md`).

## How it works (in one minute)

- **Framework:** [`next-intl`](https://next-intl.dev) in *no-URL-routing* mode.
  Pilot routes **tenants** by subdomain, so the locale is **not** a URL prefix —
  it is resolved per request.
- **Single source of languages:** `i18n/config.ts`. Add a language there and the
  routing, detection, language selector, formatting and governance tests all
  pick it up. Nothing else hard-codes the list.
- **Resolution precedence** (`i18n/request.ts`):
  1. `NEXT_LOCALE` cookie (the durable, cross-device preference),
  2. `Accept-Language` negotiation,
  3. English (`defaultLocale`).
- **Persistence:** the choice is stored on `user_profiles.locale`
  (migration `20260714180000_add_user_locale.sql`) and mirrored into the
  apex-scoped `NEXT_LOCALE` cookie. On every login the cookie is re-seeded from
  the profile (`lib/i18n/locale-cookie.ts`), so the preference follows the user
  across sessions and devices.
- **Fallback:** English is the guaranteed per-key fallback. Non-English
  catalogues are **deep-merged onto English** (`i18n/load.ts`), so any key a
  translation has not yet filled renders its English string rather than a raw
  key or a blank.

## Message catalogues

```
messages/
  _translation-status.json   # review status per locale (source vs machine-draft)
  en/                        # SOURCE OF TRUTH — edit these first
    common.json  nav.json  shell.json  settings.json  auth.json …
  nl/  de/  fr/  no/  da/  es/   # one folder per locale, same filenames
```

Each `*.json` file is a **namespace** (keyed by filename). Underscore-prefixed
files (e.g. `_translation-status.json`) are ignored by the loader.

## Adding or changing a user-facing string

1. **Add the key to `messages/en/<namespace>.json`** first. English is the
   contract every other locale is validated against.
2. **Use it in the component:**
   - Server component / server action: `const t = await getTranslations("nav"); t("items.briefing")`
   - Client component: `const t = useTranslations("nav"); t("items.briefing")`
   - Need a value from another namespace? Take a second translator
     (`getTranslations("common")`) — next-intl namespaces are not relative.
3. **Never hard-code display text, placeholders, `aria-label`s, or toast/error
   strings.** Server-action errors that surface in the UI should be returned as
   **codes** and mapped to messages in the component, not as English sentences.
4. **Never format dates/numbers/currency with a hard-coded locale**
   (`toLocaleDateString("en-GB", …)`). Resolve the active locale and use the
   helpers in `lib/i18n/format.ts` (`formatDate`, `formatNumber`,
   `formatCurrency`, `formatRelativeTime`, …). They key off each locale's
   BCP-47 `formatLocale` (e.g. `no` → `nb-NO`).
5. **Pluralisation & interpolation** use ICU syntax, e.g.
   `"available": "{count, plural, one {# invitation available} other {# invitations available}}"`.
   Keep `#`, the category names (`one`/`other`) and `{braces}` verbatim in
   translations — translate only the words.

## Translating a locale

- Copy the shape of `messages/en/<file>.json` into `messages/<locale>/<file>.json`.
- **Preserve every key name and every `{placeholder}` exactly.** Only translate
  the string values.
- Keep brand/technical terms as-is: `Paylo.one`, `Paylo One`, `Pilot`, `MCP`,
  `GDPR`. Keep `·` separators.
- The current non-English catalogues are **machine-drafted** (see
  `_translation-status.json`) and **await native linguistic review** before they
  can be considered production-ready. Reviewer notes worth resolving are tracked
  in the PR.

## AI output language (ADR-052 §8–9)

The user's language is threaded into AI execution context so AI-generated prose
comes back in their language:

- **Model Gateway** calls inherit it automatically — `service.invoke` resolves
  the active language once at the boundary and the pipeline appends a directive
  to the (tenant-owned) system prompt.
- **Direct-SDK** calls (e.g. the diary weekly summary) apply
  `languageDirective()` at the call site.

Safety: the language is always a **fixed English endonym from `localeConfig`**,
never raw request input; the directive is a static, tenant-agnostic sentence
appended *after* the system prompt (so it cannot override safety/role
instructions) and it instructs the model to keep names, identifiers and source
references verbatim. Structured/JSON-metadata calls are deliberately left in
English (the values are enums/ids, not prose). See `lib/i18n/ai-language.ts`.

## Tests / governance

`lib/i18n/*.test.ts` cover locale resolution, the English fallback, formatting,
the AI directive safety rules, and **catalogue integrity** — every locale must
have the same namespace files as English, valid JSON, and introduce no
`{placeholder}` English does not define. Run `npm run test`.

## Known follow-ups

- Native linguistic review of all six non-English catalogues.
- Extraction of the remaining feature-surface strings (see the PR description
  for the tracked list): briefing, actions, diary, people, companies, sources,
  prompts, intelligence, mcp, billing detail screens, and the server-action
  error strings across `app/(app)/**/actions.ts`.
- Governance reconciliation: append **ADR-052** to the governance repo's
  `docs/decisions/architecture-decisions.md`.
