-- ============================================================================
-- 20260721090000_connection_evidence.sql
-- Evidence-based connection scoring for the relationship graph.
--
-- 1. entity_links gains structured evidence: the individual scoring signals
--    behind a suggested connection (JSONB), how many distinct pieces of
--    evidence support it, which scoring version produced it, and when it was
--    last recalculated. This is what lets the UI explain *why* a connection
--    exists without exposing raw embedding scores.
--
-- 2. Removes the systemic noise the previous semantic pass created: system-
--    suggested source_item<->source_item "mentioned_with" edges. These linked
--    messages to messages (mostly exact duplicate ingested rows at ~100%
--    vector similarity), never people to people, and drowned the review queue
--    (9k+ rows on real tenants). Only rows still in `suggested` status are
--    removed; operator decisions (confirmed/rejected) are preserved. The
--    revised semantic-linking service no longer generates this pair type, so
--    the noise cannot come back.
-- ============================================================================

alter table public.entity_links
  add column if not exists evidence jsonb,
  add column if not exists evidence_count integer not null default 0,
  add column if not exists score_version text,
  add column if not exists computed_at timestamptz;

comment on column public.entity_links.evidence is
  'Structured scoring signals behind this edge: [{kind, count, last_at, detail, sample}]. Human-explainable; never raw vector scores alone.';
comment on column public.entity_links.evidence_count is
  'Number of distinct evidence items (deduplicated source content) supporting this edge.';
comment on column public.entity_links.score_version is
  'Version tag of the scoring model that produced confidence/evidence (see modules/people/connection-scoring.ts).';
comment on column public.entity_links.computed_at is
  'When the scoring pipeline last recalculated this edge.';

create index if not exists entity_links_tenant_status_idx
  on public.entity_links (tenant_id, status, relationship_type);

-- Purge the message<->message suggestion noise (regenerable, suggested-only).
delete from public.entity_links
where origin = 'system'
  and status = 'suggested'
  and source_entity_type = 'source_item'
  and target_entity_type = 'source_item';
