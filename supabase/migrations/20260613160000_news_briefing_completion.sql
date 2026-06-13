-- ============================================================================
-- Complete the optional News Briefing MVP after the base news schema.
--
-- Adds:
--   - RLS for the platform provider registry
--   - tenant-level provider/adaptor configuration
--   - ingestion-run observability
--   - stronger story-deduplication metadata
--   - news-item provenance on source references
--   - News in the canonical source-system constraint
-- ============================================================================

-- Harden the shared timestamp trigger used by the News preference/config tables.
alter function public.set_updated_at() set search_path = '';

-- The provider catalogue is globally readable by signed-in users, but remains
-- service-role writable. RLS is still required because public is exposed.
alter table public.news_provider enable row level security;
create policy news_provider_authenticated_select on public.news_provider
  for select to authenticated using (true);

-- Per-tenant adaptor selection and non-secret provider configuration. API keys
-- remain environment/server secrets and never belong in this table.
create table public.news_source_config (
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  provider_key text not null references public.news_provider(provider_key),
  enabled      boolean not null default true,
  feed_urls    text[] not null default '{}',
  settings     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  updated_by   uuid references auth.users(id) on delete set null,
  primary key (tenant_id, provider_key)
);
create trigger news_source_config_set_updated_at
  before update on public.news_source_config
  for each row execute function public.set_updated_at();

-- One row per tenant ingestion attempt. Provider failures are captured as data
-- so a partial provider outage never has to fail the main Daily Memo.
create table public.news_ingestion_run (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  status          text not null default 'running'
                    check (status in ('running','completed','partial','failed')),
  fetched_count   int not null default 0,
  deduped_count   int not null default 0,
  stored_count    int not null default 0,
  candidate_count int not null default 0,
  provider_errors jsonb not null default '[]'::jsonb,
  error_message   text,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz
);
create index news_ingestion_run_tenant_idx
  on public.news_ingestion_run (tenant_id, started_at desc);

-- URL remains the hard unique key. These additional fingerprints support
-- near-duplicate detection across publications without unsafe cross-tenant
-- uniqueness constraints.
alter table public.news_item
  add column title_hash text,
  add column story_fingerprint text;
create index news_item_story_fingerprint_idx
  on public.news_item (tenant_id, story_fingerprint, published_at desc);

-- Preserve first-class provenance from a briefing section to the exact news
-- item while keeping the existing source-item reference path unchanged.
alter table public.source_references
  add column news_item_id uuid references public.news_item(id) on delete set null;
create index source_references_news_item_idx
  on public.source_references (news_item_id)
  where news_item_id is not null;

-- News is a source-system identifier even though its configuration lives in
-- news_tenant_preferences/news_source_config rather than OAuth connections.
alter table public.source_connections
  drop constraint if exists source_connections_system_check;
alter table public.source_connections
  add constraint source_connections_system_check
  check (system in (
    'email','ms365_mail','calendar','teams','whatsapp',
    'github','notion','file_upload','obsidian','news'
  ));

grant select on table public.news_source_config to authenticated;
grant select on table public.news_ingestion_run to authenticated;
grant all on table public.news_source_config to service_role;
grant all on table public.news_ingestion_run to service_role;

alter table public.news_source_config enable row level security;
alter table public.news_ingestion_run enable row level security;

create policy news_source_config_select on public.news_source_config
  for select to authenticated
  using (tenant_id in (select public.auth_tenant_ids()));
create policy news_ingestion_run_select on public.news_ingestion_run
  for select to authenticated
  using (tenant_id in (select public.auth_tenant_ids()));
