-- ============================================================================
-- 20260607160004_github_repository_monitors.sql
-- Repository-level GitHub monitoring (ADR-024): the operator selects specific
-- repositories and the per-repo signals to monitor. Nothing is monitored or
-- ingested until a repository is explicitly activated. Tenant-isolated via
-- public.auth_tenant_ids(), same pattern as source_connections.
--
-- Also extends source_connections.system to admit the two new source types
-- (ms365_mail, obsidian) so the enum matches the app's SourceSystem.
-- Governance: architecture/source-integration-strategy.md §7,
-- services/source-connection.md (addendum), services/ingestion.md (addendum).
-- ============================================================================

-- --- Keep source_connections.system in step with the app's SourceSystem ------
alter table public.source_connections
  drop constraint if exists source_connections_system_check;
alter table public.source_connections
  add constraint source_connections_system_check
  check (system in (
    'email','ms365_mail','calendar','teams','whatsapp',
    'github','notion','file_upload','obsidian'
  ));

-- --- Repository monitors -----------------------------------------------------
-- One row per (github connection, repository). is_active is the explicit
-- approval gate; the monitor_* flags are the per-repo signal selection.
create table public.github_repository_monitors (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  source_connection_id    uuid not null references public.source_connections(id) on delete cascade,
  github_account_id       text not null,                 -- owner login (user/org)
  repository_id           bigint not null,               -- GitHub numeric repo id
  repository_full_name    text not null,                 -- "owner/name"
  description             text,
  visibility              text check (visibility in ('public','private','internal')),
  is_active               boolean not null default false, -- explicit approval gate
  monitor_pull_requests   boolean not null default true,
  monitor_issues          boolean not null default true,
  monitor_commits         boolean not null default false,
  monitor_releases        boolean not null default true,
  monitor_discussions     boolean not null default false,
  monitor_workflows       boolean not null default false,
  monitor_security_alerts boolean not null default false,
  monitor_metadata        boolean not null default true,
  monitor_readme_docs     boolean not null default false,
  last_sync_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (source_connection_id, repository_id)
);
create index github_repository_monitors_tenant_idx
  on public.github_repository_monitors (tenant_id);
create index github_repository_monitors_conn_idx
  on public.github_repository_monitors (source_connection_id, repository_full_name);
create trigger github_repository_monitors_set_updated_at
  before update on public.github_repository_monitors
  for each row execute function public.set_updated_at();

-- --- Grants ------------------------------------------------------------------
-- Operator-owned from the UI (select repos, toggle signals) → authenticated
-- gets CRUD; server/worker (callback discovery + sync) uses service_role.
grant select, insert, update, delete
  on table public.github_repository_monitors to authenticated;
grant all on table public.github_repository_monitors to service_role;

-- --- RLS ---------------------------------------------------------------------
alter table public.github_repository_monitors enable row level security;

create policy gh_repo_monitors_select on public.github_repository_monitors
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );
create policy gh_repo_monitors_insert on public.github_repository_monitors
  for insert to authenticated
  with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy gh_repo_monitors_update on public.github_repository_monitors
  for update to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) )
  with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy gh_repo_monitors_delete on public.github_repository_monitors
  for delete to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );
