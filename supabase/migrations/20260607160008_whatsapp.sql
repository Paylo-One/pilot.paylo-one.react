-- ============================================================================
-- 20260607160008_whatsapp.sql
-- Tenant-scoped WhatsApp sessions + monitoring of *selected people/chats only*.
-- One isolated session per tenant. Session metadata lives here; session
-- MATERIAL (auth/credentials) is NOT stored in these tables — it is held in
-- integration_credentials / a secret store with NO authenticated grant, like
-- every other source credential. RLS-isolated via public.auth_tenant_ids().
-- Governance: architecture/whatsapp-session-architecture.md (ADR-030/031/032),
-- data-architecture.md.
-- ============================================================================

-- --- whatsapp_sessions (one per tenant; metadata only) ----------------------
create table public.whatsapp_sessions (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  source_connection_id uuid references public.source_connections(id) on delete cascade,
  status               text not null default 'disconnected'
                       check (status in ('disconnected','awaiting_qr','connecting','connected','needs_reconnect','expired','error')),
  qr_code_status       text not null default 'none'
                       check (qr_code_status in ('none','pending','scanned','expired')),
  device_label         text,
  last_connected_at    timestamptz,
  last_health_check_at timestamptz,
  disconnected_at      timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id)  -- one session per tenant
);
create trigger whatsapp_sessions_set_updated_at before update on public.whatsapp_sessions
  for each row execute function public.set_updated_at();

-- --- whatsapp_contacts ------------------------------------------------------
create table public.whatsapp_contacts (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  whatsapp_session_id uuid not null references public.whatsapp_sessions(id) on delete cascade,
  name                text,
  phone_masked        text,
  provider_id         text not null,
  person_id           uuid references public.people(id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (whatsapp_session_id, provider_id)
);
create index whatsapp_contacts_tenant_idx on public.whatsapp_contacts (tenant_id);

-- --- whatsapp_chats ---------------------------------------------------------
create table public.whatsapp_chats (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  whatsapp_session_id uuid not null references public.whatsapp_sessions(id) on delete cascade,
  name                text,
  kind                text not null default 'direct' check (kind in ('direct','group')),
  participant_count   int not null default 2,
  provider_id         text not null,
  created_at          timestamptz not null default now(),
  unique (whatsapp_session_id, provider_id)
);
create index whatsapp_chats_tenant_idx on public.whatsapp_chats (tenant_id);

-- --- whatsapp_monitors (explicit per-person/chat approval gate) -------------
create table public.whatsapp_monitors (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  whatsapp_session_id  uuid not null references public.whatsapp_sessions(id) on delete cascade,
  chat_id              text not null,                 -- provider chat id
  chat_name            text,
  chat_kind            text not null default 'direct' check (chat_kind in ('direct','group')),
  person_id            uuid references public.people(id) on delete set null,
  is_active            boolean not null default false,
  include_in_daily_memo boolean not null default false,
  storage_policy       text not null default 'no_raw'
                       check (storage_policy in ('raw_and_summaries','summaries_only','no_raw','disabled')),
  last_sync_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (whatsapp_session_id, chat_id)
);
create index whatsapp_monitors_tenant_idx on public.whatsapp_monitors (tenant_id);
create trigger whatsapp_monitors_set_updated_at before update on public.whatsapp_monitors
  for each row execute function public.set_updated_at();

-- --- whatsapp_messages (only from active monitors; body per policy) ---------
create table public.whatsapp_messages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  chat_id     text not null,
  from_name   text,
  body        text,                                   -- null under no_raw
  occurred_at timestamptz,
  person_id   uuid references public.people(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index whatsapp_messages_tenant_idx on public.whatsapp_messages (tenant_id, occurred_at desc);

-- ============================================================================
-- Grants — operator manages monitors; session/contacts/chats/messages are
-- server-managed (discovery + ingestion run server-side).
-- ============================================================================
grant select on table public.whatsapp_sessions to authenticated;
grant select on table public.whatsapp_contacts to authenticated;
grant select on table public.whatsapp_chats to authenticated;
grant select, insert, update, delete on table public.whatsapp_monitors to authenticated;
grant select on table public.whatsapp_messages to authenticated;

grant all on table public.whatsapp_sessions to service_role;
grant all on table public.whatsapp_contacts to service_role;
grant all on table public.whatsapp_chats to service_role;
grant all on table public.whatsapp_monitors to service_role;
grant all on table public.whatsapp_messages to service_role;

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.whatsapp_sessions enable row level security;
alter table public.whatsapp_contacts enable row level security;
alter table public.whatsapp_chats    enable row level security;
alter table public.whatsapp_monitors enable row level security;
alter table public.whatsapp_messages enable row level security;

create policy wa_sessions_select on public.whatsapp_sessions for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy wa_contacts_select on public.whatsapp_contacts for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy wa_chats_select    on public.whatsapp_chats    for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy wa_messages_select on public.whatsapp_messages for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );

create policy wa_monitors_select on public.whatsapp_monitors for select to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
create policy wa_monitors_insert on public.whatsapp_monitors for insert to authenticated with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy wa_monitors_update on public.whatsapp_monitors for update to authenticated using ( tenant_id in (select public.auth_tenant_ids()) ) with check ( tenant_id in (select public.auth_tenant_ids()) );
create policy wa_monitors_delete on public.whatsapp_monitors for delete to authenticated using ( tenant_id in (select public.auth_tenant_ids()) );
