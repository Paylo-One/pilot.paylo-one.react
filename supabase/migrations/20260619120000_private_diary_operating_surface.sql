-- ============================================================================
-- Private Diary operating surface
--
-- Adds voice-note metadata, lightweight risk lifecycle state, weekly summaries,
-- and diary-origin provenance for Actions. Diary rows remain author-scoped by
-- the existing diary_author_* RLS policies.
-- ============================================================================

alter table public.diary_entries
  add column if not exists audio_storage_path text,
  add column if not exists audio_mime_type text,
  add column if not exists audio_duration_seconds integer
    check (audio_duration_seconds is null or audio_duration_seconds >= 0),
  add column if not exists transcription_status text not null default 'none'
    check (transcription_status in ('none', 'pending', 'done', 'failed')),
  add column if not exists risk_status text
    check (risk_status in ('active', 'resolved')),
  add column if not exists risk_resolved_at timestamptz,
  add column if not exists risk_resolution_note text;

create index if not exists diary_entries_active_risks_idx
  on public.diary_entries (tenant_id, author_user_id, created_at desc)
  where entry_type = 'risk' and coalesce(risk_status, 'active') = 'active';

alter table public.source_references
  add column if not exists diary_entry_id uuid references public.diary_entries(id) on delete set null;

create index if not exists source_references_diary_entry_idx
  on public.source_references (tenant_id, diary_entry_id)
  where diary_entry_id is not null;

create table if not exists public.diary_weekly_summaries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  week_start_date date not null,
  key_reflections text[] not null default '{}',
  important_decisions text[] not null default '{}',
  notable_risks text[] not null default '{}',
  follow_ups_created text[] not null default '{}',
  recurring_themes text[] not null default '{}',
  next_week_attention text[] not null default '{}',
  entry_count integer not null default 0 check (entry_count >= 0),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, author_user_id, week_start_date)
);

create index if not exists diary_weekly_summaries_author_idx
  on public.diary_weekly_summaries (tenant_id, author_user_id, week_start_date desc);

create trigger diary_weekly_summaries_set_updated_at
  before update on public.diary_weekly_summaries
  for each row execute function public.set_updated_at();

alter table public.diary_weekly_summaries enable row level security;

grant select, insert, update, delete on table public.diary_weekly_summaries to authenticated;
grant all on table public.diary_weekly_summaries to service_role;

drop policy if exists diary_weekly_summaries_author_select on public.diary_weekly_summaries;
create policy diary_weekly_summaries_author_select on public.diary_weekly_summaries
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) and author_user_id = (select auth.uid()) );

drop policy if exists diary_weekly_summaries_author_insert on public.diary_weekly_summaries;
create policy diary_weekly_summaries_author_insert on public.diary_weekly_summaries
  for insert to authenticated
  with check ( tenant_id in (select public.auth_tenant_ids()) and author_user_id = (select auth.uid()) );

drop policy if exists diary_weekly_summaries_author_update on public.diary_weekly_summaries;
create policy diary_weekly_summaries_author_update on public.diary_weekly_summaries
  for update to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) and author_user_id = (select auth.uid()) )
  with check ( tenant_id in (select public.auth_tenant_ids()) and author_user_id = (select auth.uid()) );

drop policy if exists diary_weekly_summaries_author_delete on public.diary_weekly_summaries;
create policy diary_weekly_summaries_author_delete on public.diary_weekly_summaries
  for delete to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) and author_user_id = (select auth.uid()) );
