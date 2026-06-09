-- ============================================================================
-- 20260607160010_suggestion_preview.sql
-- Carry the triggering signal's preview text on a link suggestion so the
-- "Is this the same person?" prompt can show what prompted it.
-- Governance: services/information-correlation-service.md.
-- ============================================================================

alter table public.person_link_suggestions add column signal_preview text;
