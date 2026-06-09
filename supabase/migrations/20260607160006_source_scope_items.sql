-- ============================================================================
-- 20260607160006_source_scope_items.sql
-- Generic per-source scope selection (source-integration-strategy.md §5/§8/§9).
-- Used by the Google family: Gmail labels/folders and Google calendars the
-- operator selects. One row per (connection, external item); is_active is the
-- explicit approval gate — only active items are synced. Tenant-isolated via
-- public.auth_tenant_ids() (same pattern as github_repository_monitors /
-- notion_resources). Kept generic so other selectable-scope sources can reuse it.
-- ============================================================================

create table public.source_scope_items (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  source_connection_id uuid not null references public.source_connections(id) on delete cascade,
  system               text not null,                 -- 'email' | 'calendar'
  item_type            text not null,                 -- 'gmail_label' | 'google_calendar'
  external_id          text not null,                 -- provider id (label id / calendar id)
  name                 text,
  is_active            boolean not null default false, -- explicit approval gate
  metadata             jsonb,
  last_sync_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (source_connection_id, external_id)
);
create index source_scope_items_tenant_idx on public.source_scope_items (tenant_id);
create index source_scope_items_conn_idx
  on public.source_scope_items (source_connection_id, name);
create trigger source_scope_items_set_updated_at
  before update on public.source_scope_items
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on table public.source_scope_items to authenticated;
grant all on table public.source_scope_items to service_role;

alter table public.source_scope_items enable row level security;

create policy scope_items_select on public.source_scope_items
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );
create policy scope_items_insert on public.source_scope_items
  for insert to authenticated
  with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy scope_items_update on public.source_scope_items
  for update to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) )
  with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy scope_items_delete on public.source_scope_items
  for delete to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );
