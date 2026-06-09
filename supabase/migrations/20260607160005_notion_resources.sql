-- ============================================================================
-- 20260607160005_notion_resources.sql
-- Notion page/database selection (source-integration-strategy.md §12). The
-- operator shares pages/databases with their Notion integration; we discover
-- them and the operator activates the ones to sync. Nothing is ingested until a
-- resource is activated. Tenant-isolated via public.auth_tenant_ids(), same
-- pattern as github_repository_monitors.
-- ============================================================================

create table public.notion_resources (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  source_connection_id uuid not null references public.source_connections(id) on delete cascade,
  notion_id            text not null,                 -- Notion page/database id
  object_type          text not null
                       check (object_type in ('page','database')),
  title                text,
  url                  text,
  is_active            boolean not null default false, -- explicit approval gate
  last_sync_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (source_connection_id, notion_id)
);
create index notion_resources_tenant_idx on public.notion_resources (tenant_id);
create index notion_resources_conn_idx
  on public.notion_resources (source_connection_id, title);
create trigger notion_resources_set_updated_at
  before update on public.notion_resources
  for each row execute function public.set_updated_at();

-- Grants: operator-owned from the UI; server/worker uses service_role.
grant select, insert, update, delete on table public.notion_resources to authenticated;
grant all on table public.notion_resources to service_role;

-- RLS — tenant-scoped, mirrors source_connections / github_repository_monitors.
alter table public.notion_resources enable row level security;

create policy notion_resources_select on public.notion_resources
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );
create policy notion_resources_insert on public.notion_resources
  for insert to authenticated
  with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy notion_resources_update on public.notion_resources
  for update to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) )
  with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy notion_resources_delete on public.notion_resources
  for delete to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );
