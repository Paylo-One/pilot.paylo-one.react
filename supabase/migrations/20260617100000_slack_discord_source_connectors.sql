-- ============================================================================
-- Slack + Discord source connectors.
--
-- Extends the generic source connection and scope-item model instead of adding
-- connector-specific tables. Public Slack channels and Discord server channels
-- are source_scope_items; provider cursors live beside the operator's scope
-- choice so sync can remain incremental and channel-scoped.
-- ============================================================================

-- Canonical source-system constraint.
alter table public.source_connections
  drop constraint if exists source_connections_system_check;
alter table public.source_connections
  add constraint source_connections_system_check
  check (system in (
    'email','ms365_mail','calendar','teams','slack','discord','whatsapp',
    'github','notion','file_upload','obsidian','news'
  ));

-- Provider/workspace metadata and sync observability.
alter table public.source_connections
  add column if not exists provider_workspace_id text,
  add column if not exists provider_workspace_name text,
  add column if not exists permissions_granted jsonb,
  add column if not exists sync_cursor text,
  add column if not exists last_successful_sync_at timestamptz,
  add column if not exists failed_sync_attempts int not null default 0;

create index if not exists source_connections_provider_workspace_idx
  on public.source_connections (tenant_id, system, provider_workspace_id)
  where provider_workspace_id is not null;

-- Channel-level controls reused by Slack/Discord and available to future
-- selectable sources. is_active means "sync it"; include_in_daily_memo means
-- "allow it into briefing/action context"; priority lets important channels
-- enter retrieval ahead of ordinary channel noise.
alter table public.source_scope_items
  add column if not exists include_in_daily_memo boolean not null default true,
  add column if not exists priority text not null default 'normal',
  add column if not exists sync_cursor text;

alter table public.source_scope_items
  drop constraint if exists source_scope_items_priority_check;
alter table public.source_scope_items
  add constraint source_scope_items_priority_check
  check (priority in ('normal','high'));

create index if not exists source_scope_items_active_system_idx
  on public.source_scope_items (tenant_id, system, is_active, include_in_daily_memo);

create index if not exists source_scope_items_priority_idx
  on public.source_scope_items (tenant_id, priority)
  where is_active = true and include_in_daily_memo = true;

-- People correlation can now store confirmed Slack/Discord handles or provider
-- ids as first-class source identities.
alter table public.person_identities
  drop constraint if exists person_identities_identity_type_check;
alter table public.person_identities
  add constraint person_identities_identity_type_check
  check (identity_type in (
    'email','phone','whatsapp','teams','slack','discord','github','notion','alias'
  ));
