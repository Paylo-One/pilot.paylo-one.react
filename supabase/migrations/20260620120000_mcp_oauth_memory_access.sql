-- 20260620120000_mcp_oauth_memory_access.sql
-- Production-shaped MCP access for Pilot workspace memory:
-- OAuth clients, authorisation codes, grants, short-lived access tokens,
-- refresh-token rotation state, revocation, and content-safe MCP audit events.

create table public.mcp_oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  client_secret_hash text,
  name text not null,
  description text,
  client_type text not null check (client_type in ('public', 'confidential')),
  redirect_uris text[] not null default '{}',
  allowed_scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    client_type = 'public'
    or (client_type = 'confidential' and client_secret_hash is not null)
  )
);

create trigger mcp_oauth_clients_set_updated_at
  before update on public.mcp_oauth_clients
  for each row execute function public.set_updated_at();

create table public.mcp_oauth_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.mcp_oauth_clients(id) on delete cascade,
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'revoked')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz,
  refresh_token_hash text,
  refresh_token_expires_at timestamptz,
  refresh_token_rotated_at timestamptz,
  unique (tenant_id, user_id, client_id)
);

create index mcp_oauth_grants_tenant_user_idx
  on public.mcp_oauth_grants (tenant_id, user_id, status, granted_at desc);

create index mcp_oauth_grants_refresh_hash_idx
  on public.mcp_oauth_grants (refresh_token_hash)
  where refresh_token_hash is not null;

create table public.mcp_oauth_authorization_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  grant_id uuid not null references public.mcp_oauth_grants(id) on delete cascade,
  client_id uuid not null references public.mcp_oauth_clients(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_uri text not null,
  scopes text[] not null default '{}',
  code_challenge text not null,
  code_challenge_method text not null default 'plain'
    check (code_challenge_method in ('plain', 'S256')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index mcp_oauth_authorization_codes_expiry_idx
  on public.mcp_oauth_authorization_codes (expires_at);

create table public.mcp_oauth_access_tokens (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.mcp_oauth_grants(id) on delete cascade,
  token_hash text not null unique,
  scopes text[] not null default '{}',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index mcp_oauth_access_tokens_expiry_idx
  on public.mcp_oauth_access_tokens (expires_at);

create table public.mcp_audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  grant_id uuid references public.mcp_oauth_grants(id) on delete set null,
  client_id text not null,
  event_type text not null,
  tool_name text,
  scopes text[] not null default '{}',
  status text not null check (status in ('success', 'denied', 'error')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index mcp_audit_events_tenant_user_idx
  on public.mcp_audit_events (tenant_id, user_id, created_at desc);

create index mcp_audit_events_tool_idx
  on public.mcp_audit_events (tenant_id, tool_name, created_at desc)
  where tool_name is not null;

alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_grants enable row level security;
alter table public.mcp_oauth_authorization_codes enable row level security;
alter table public.mcp_oauth_access_tokens enable row level security;
alter table public.mcp_audit_events enable row level security;

grant select on table public.mcp_oauth_clients to authenticated;
grant select on table public.mcp_oauth_grants to authenticated;
grant select on table public.mcp_audit_events to authenticated;

grant all on table public.mcp_oauth_clients to service_role;
grant all on table public.mcp_oauth_grants to service_role;
grant all on table public.mcp_oauth_authorization_codes to service_role;
grant all on table public.mcp_oauth_access_tokens to service_role;
grant all on table public.mcp_audit_events to service_role;

create policy mcp_clients_active_select on public.mcp_oauth_clients
  for select to authenticated
  using (status = 'active');

create policy mcp_grants_owner_select on public.mcp_oauth_grants
  for select to authenticated
  using (
    tenant_id in (select public.auth_tenant_ids())
    and user_id = auth.uid()
  );

create policy mcp_audit_owner_select on public.mcp_audit_events
  for select to authenticated
  using (
    tenant_id in (select public.auth_tenant_ids())
    and user_id = auth.uid()
  );

-- No authenticated policies for authorisation codes or access tokens. They are
-- handled only by server-side OAuth routes under service_role.

insert into public.mcp_oauth_clients (
  client_id,
  name,
  description,
  client_type,
  redirect_uris,
  allowed_scopes
) values (
  'pilot-local-mcp',
  'Pilot Local MCP Client',
  'Default public client for local, user-approved MCP tools. Use only with PKCE.',
  'public',
  array[
    'http://localhost:6274/oauth/callback',
    'http://127.0.0.1:6274/oauth/callback',
    'http://localhost:3334/oauth/callback',
    'http://127.0.0.1:3334/oauth/callback'
  ],
  array[
    'memory:read',
    'actions:read',
    'actions:write',
    'diary:read',
    'diary:write',
    'briefings:read',
    'sources:read',
    'people:read',
    'risks:read',
    'decisions:read'
  ]
) on conflict (client_id) do update set
  name = excluded.name,
  description = excluded.description,
  client_type = excluded.client_type,
  redirect_uris = excluded.redirect_uris,
  allowed_scopes = excluded.allowed_scopes,
  status = 'active',
  updated_at = now();
