-- ============================================================================
-- 20260611140000_github_memo_toggle.sql
-- Per-repository Daily Memo inclusion for GitHub monitors — parity with
-- whatsapp_monitors.include_in_daily_memo. `is_active` remains the ingestion
-- approval gate; this flag only controls whether an active repository's items
-- qualify for the Daily Memo retrieval pool (knowledge-store
-- listMemoSourceItems). Defaults TRUE to preserve existing behaviour: every
-- already-active repository keeps informing the memo until the operator opts
-- it out.
-- ============================================================================

alter table public.github_repository_monitors
  add column include_in_daily_memo boolean not null default true;
