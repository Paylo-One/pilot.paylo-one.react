-- Migration: Add locale to user_profiles (ADR-052 — Pilot application i18n)
-- Path: supabase/migrations/20260714180000_add_user_locale.sql
--
-- The user's durable, cross-device language preference. Resolved into the
-- NEXT_LOCALE cookie on app load (app/(app)/layout.tsx) and consumed by
-- i18n/request.ts. NULL means "no explicit choice yet" — the app then falls
-- back to Accept-Language negotiation and finally to English (defaultLocale).
--
-- A CHECK constraint keeps the column aligned with the supported-locale list in
-- i18n/config.ts. Adding a language means extending BOTH lists (the message
-- integrity test asserts they agree). Written under RLS by the user themselves
-- via the existing user_profiles_self_* policies (user_id = auth.uid()).

alter table public.user_profiles
  add column locale text
    check (locale is null or locale in ('en', 'nl', 'de', 'fr', 'no', 'da', 'es'));

comment on column public.user_profiles.locale is
  'BCP-47 base language tag for the user''s UI + AI-output language preference. '
  'One of the supported locales in i18n/config.ts, or NULL for auto-detect. '
  'Persisted per user so the choice follows them across sessions and devices.';
