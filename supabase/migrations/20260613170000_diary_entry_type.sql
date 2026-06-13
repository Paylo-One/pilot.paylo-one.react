-- ============================================================================
-- Diary — entry type (ADR-041)
--
-- Adds a single, lightweight entry type to each diary entry so the redesigned
-- Diary can group, filter, and (later) connect entries to the matching OS
-- surface (decisions, actions, people, meetings). The type is optional from the
-- operator's point of view: it defaults to 'note', so existing rows and any
-- entry saved without a choice are simply notes.
--
-- Privacy and author-scoping are unchanged: the existing diary_author_* RLS
-- policies and the (tenant_id, author_user_id, created_at desc) index continue
-- to govern every read and write. Adding a NOT NULL column with a constant
-- default back-fills existing rows to 'note' without a table rewrite.
-- ============================================================================

alter table public.diary_entries
  add column entry_type text not null default 'note'
    check (entry_type in (
      'note','decision','action','reflection','meeting','idea','risk','follow_up'
    ));
