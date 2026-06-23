-- Actions cleanup and duplicate-review metadata.
-- The current UI can group likely duplicates heuristically; these columns give
-- the extraction/cleanup pipeline a durable place to persist future proposals.

alter table public.suggested_actions
  add column if not exists duplicate_signature text,
  add column if not exists duplicate_group_id uuid,
  add column if not exists duplicate_confidence numeric
    check (duplicate_confidence is null or (duplicate_confidence >= 0 and duplicate_confidence <= 1)),
  add column if not exists duplicate_reason text,
  add column if not exists merged_into_action_id uuid references public.suggested_actions(id) on delete set null,
  add column if not exists cleanup_metadata jsonb not null default '{}'::jsonb;

create index if not exists suggested_actions_duplicate_group_idx
  on public.suggested_actions (tenant_id, duplicate_group_id)
  where duplicate_group_id is not null;

create index if not exists suggested_actions_duplicate_signature_idx
  on public.suggested_actions (tenant_id, duplicate_signature)
  where duplicate_signature is not null;
