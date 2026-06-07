-- ============================================================================
-- 20260607160002_product_schema.sql
-- Product schema: sources/ingestion, briefing, actions, diary, audit, usage.
-- Every tenant-owned table carries tenant_id and is RLS-isolated via
-- public.auth_tenant_ids(). Governance: data-architecture.md, services/*.
--
-- Write/read split:
--   - End users (authenticated role) read most tables and mutate the few they
--     own from the UI (source_connections, suggested_actions, diary_entries).
--   - Server/worker code (service_role, BYPASSRLS) performs ingestion, briefing
--     generation, audit, and usage writes.
--   - integration_credentials is NEVER granted to authenticated (secrets).
-- ============================================================================

-- Reusable trigger to maintain updated_at.
create or replace function public.set_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- --- Sources & ingestion ----------------------------------------------------

create table public.source_connections (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  system         text not null
                 check (system in ('email','calendar','teams','whatsapp','github','notion','file_upload')),
  display_name   text not null,
  status         text not null default 'connected'
                 check (status in ('connected','disconnected','error')),
  storage_policy text not null default 'summaries_only'
                 check (storage_policy in ('raw_and_summaries','summaries_only','no_raw','disabled')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index source_connections_tenant_idx on public.source_connections (tenant_id);
create trigger source_connections_set_updated_at before update on public.source_connections
  for each row execute function public.set_updated_at();

-- Tenant-scoped, encrypted-at-rest later. NEVER exposed to authenticated.
create table public.integration_credentials (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  source_connection_id uuid not null references public.source_connections(id) on delete cascade,
  access_token         text,
  refresh_token        text,
  scope                text,
  expires_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index integration_credentials_tenant_idx on public.integration_credentials (tenant_id);

create table public.source_items (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  source_connection_id uuid references public.source_connections(id) on delete set null,
  system               text not null,
  external_id          text,
  kind                 text,
  title                text,
  body                 text,
  author               text,
  occurred_at          timestamptz,
  raw                  jsonb,
  created_at           timestamptz not null default now()
);
create index source_items_tenant_idx on public.source_items (tenant_id, occurred_at desc);

create table public.content_summaries (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  source_item_id uuid not null references public.source_items(id) on delete cascade,
  summary        text not null,
  created_at     timestamptz not null default now()
);
create index content_summaries_tenant_idx on public.content_summaries (tenant_id);

-- --- Briefing (Daily Memo) --------------------------------------------------

create table public.briefings (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  status       text not null default 'ready' check (status in ('generating','ready','failed')),
  summary      text,
  generated_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index briefings_tenant_idx on public.briefings (tenant_id, generated_at desc);

create table public.briefing_sections (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  briefing_id uuid not null references public.briefings(id) on delete cascade,
  kind        text not null,
  position    int not null default 0,
  title       text not null,
  body        text
);
create index briefing_sections_briefing_idx on public.briefing_sections (briefing_id, position);

-- --- Actions ----------------------------------------------------------------

create table public.suggested_actions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  briefing_id uuid references public.briefings(id) on delete set null,
  status      text not null default 'suggested'
              check (status in ('suggested','approved','edited','deferred','dismissed')),
  title       text not null,
  rationale   text,
  due_at      timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index suggested_actions_tenant_idx on public.suggested_actions (tenant_id, status);
create trigger suggested_actions_set_updated_at before update on public.suggested_actions
  for each row execute function public.set_updated_at();

-- --- Source references (provenance for every insight/action) ----------------

create table public.source_references (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  briefing_section_id uuid references public.briefing_sections(id) on delete cascade,
  suggested_action_id uuid references public.suggested_actions(id) on delete cascade,
  source_item_id      uuid references public.source_items(id) on delete set null,
  source_system       text not null,
  item_timestamp      timestamptz,
  confidence          numeric(4,3),
  excerpt_or_pointer  text,
  created_at          timestamptz not null default now()
);
create index source_references_tenant_idx on public.source_references (tenant_id);

-- --- Diary (author-scoped) --------------------------------------------------

create table public.diary_entries (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  kind           text not null default 'text' check (kind in ('text','voice')),
  body           text,
  transcript     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index diary_entries_tenant_author_idx on public.diary_entries (tenant_id, author_user_id, created_at desc);
create trigger diary_entries_set_updated_at before update on public.diary_entries
  for each row execute function public.set_updated_at();

-- --- Audit & usage ----------------------------------------------------------

create table public.audit_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  action      text not null,
  target      text,
  metadata    jsonb,
  occurred_at timestamptz not null default now()
);
create index audit_events_tenant_idx on public.audit_events (tenant_id, occurred_at desc);

create table public.model_usage (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  agent_run_id  uuid,
  model         text,
  provider      text,
  input_tokens  int,
  output_tokens int,
  total_tokens  int,
  est_cost_usd  numeric(10,5),
  latency_ms    int,
  status        text,
  created_at    timestamptz not null default now()
);
create index model_usage_tenant_idx on public.model_usage (tenant_id, created_at desc);

-- ============================================================================
-- Grants — explicit (new tables are not auto-exposed to the Data API).
-- ============================================================================

-- End-user read access.
grant select on table public.source_connections to authenticated;
grant select on table public.source_items to authenticated;
grant select on table public.content_summaries to authenticated;
grant select on table public.briefings to authenticated;
grant select on table public.briefing_sections to authenticated;
grant select on table public.source_references to authenticated;
grant select on table public.suggested_actions to authenticated;
grant select on table public.audit_events to authenticated;
grant select on table public.model_usage to authenticated;

-- End-user mutations on what the UI owns.
grant insert, update, delete on table public.source_connections to authenticated;
grant update on table public.suggested_actions to authenticated;
grant insert, update, delete on table public.diary_entries to authenticated;
grant select on table public.diary_entries to authenticated;

-- Server/worker full access (service_role bypasses RLS but still needs privileges).
grant all on table public.source_connections   to service_role;
grant all on table public.integration_credentials to service_role;
grant all on table public.source_items          to service_role;
grant all on table public.content_summaries     to service_role;
grant all on table public.briefings             to service_role;
grant all on table public.briefing_sections     to service_role;
grant all on table public.source_references     to service_role;
grant all on table public.suggested_actions     to service_role;
grant all on table public.diary_entries         to service_role;
grant all on table public.audit_events          to service_role;
grant all on table public.model_usage           to service_role;
-- integration_credentials: intentionally NO grant to authenticated/anon.

-- ============================================================================
-- RLS — enabled on every tenant-owned table.
-- ============================================================================

alter table public.source_connections     enable row level security;
alter table public.integration_credentials enable row level security;
alter table public.source_items            enable row level security;
alter table public.content_summaries       enable row level security;
alter table public.briefings               enable row level security;
alter table public.briefing_sections       enable row level security;
alter table public.source_references       enable row level security;
alter table public.suggested_actions       enable row level security;
alter table public.diary_entries           enable row level security;
alter table public.audit_events            enable row level security;
alter table public.model_usage             enable row level security;

-- Read policies (tenant isolation) for the authenticated role.
create policy src_conn_select on public.source_connections
  for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy src_items_select on public.source_items
  for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy summaries_select on public.content_summaries
  for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy briefings_select on public.briefings
  for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy briefing_sections_select on public.briefing_sections
  for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy source_refs_select on public.source_references
  for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy actions_select on public.suggested_actions
  for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy audit_select on public.audit_events
  for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy usage_select on public.model_usage
  for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );

-- Mutation policies (USING + WITH CHECK) for UI-owned tables.
create policy src_conn_insert on public.source_connections
  for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy src_conn_update on public.source_connections
  for update to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) )
  with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy src_conn_delete on public.source_connections
  for delete to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );

create policy actions_update on public.suggested_actions
  for update to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) )
  with check ( tenant_id in (select public.auth_tenant_ids()) );

-- Diary: author-scoped within the tenant (private by default).
create policy diary_author_select on public.diary_entries
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) and author_user_id = (select auth.uid()) );
create policy diary_author_insert on public.diary_entries
  for insert to authenticated
  with check ( tenant_id in (select public.auth_tenant_ids()) and author_user_id = (select auth.uid()) );
create policy diary_author_update on public.diary_entries
  for update to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) and author_user_id = (select auth.uid()) )
  with check ( tenant_id in (select public.auth_tenant_ids()) and author_user_id = (select auth.uid()) );
create policy diary_author_delete on public.diary_entries
  for delete to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) and author_user_id = (select auth.uid()) );

-- integration_credentials: RLS enabled, NO authenticated policy → denied to
-- end users entirely. Only service_role (BYPASSRLS) can touch it.
