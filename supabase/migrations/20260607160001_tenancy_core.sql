-- ============================================================================
-- 20260607160001_tenancy_core.sql
-- Tenancy core: tenants, tenant_users, tenant_domains, user_profiles, the
-- canonical RLS helper auth_tenant_ids(), explicit grants, and RLS policies.
-- Governance: governance/docs/architecture/multi-tenancy-design.md.
--
-- Isolation model: shared Postgres, shared schema, tenant_id on every
-- tenant-owned table, RLS enabled on every tenant-owned table, predicate
-- centralised in auth_tenant_ids(). Tenant provisioning runs server-side with
-- the secret key (service_role, BYPASSRLS); end-user reads/writes go through the
-- authenticated role with RLS active.
-- ============================================================================

create extension if not exists pgcrypto;

-- --- Tables -----------------------------------------------------------------

create table public.tenants (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  status     text not null default 'active'
             check (status in ('provisioning','active','suspended','deleting','deleted')),
  plan       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_users (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'owner'
             check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_users_user_id_idx on public.tenant_users (user_id);

create table public.tenant_domains (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  kind          text not null default 'subdomain' check (kind in ('subdomain','custom')),
  subdomain     text unique,
  custom_domain text unique,
  is_primary    boolean not null default true,
  verified      boolean not null default false,
  created_at    timestamptz not null default now()
);

create table public.user_profiles (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  display_name      text,
  timezone          text not null default 'UTC',
  briefing_time     time,
  default_tenant_id uuid references public.tenants(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- --- Canonical RLS predicate helper -----------------------------------------
-- Returns the tenant ids the current authenticated user belongs to. SECURITY
-- DEFINER so policies can read tenant_users without recursive RLS; locked
-- search_path; fully-qualified references.
create or replace function public.auth_tenant_ids()
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select tu.tenant_id
  from public.tenant_users tu
  where tu.user_id = (select auth.uid())
$$;

revoke all on function public.auth_tenant_ids() from public;
grant execute on function public.auth_tenant_ids() to authenticated, service_role;

-- --- Grants (explicit; new tables are not auto-exposed) ---------------------
grant select on table public.tenants to authenticated;
grant select on table public.tenant_users to authenticated;
grant select on table public.tenant_domains to authenticated;
grant select, insert, update on table public.user_profiles to authenticated;

grant all on table public.tenants to service_role;
grant all on table public.tenant_users to service_role;
grant all on table public.tenant_domains to service_role;
grant all on table public.user_profiles to service_role;

-- --- RLS --------------------------------------------------------------------
alter table public.tenants        enable row level security;
alter table public.tenant_users   enable row level security;
alter table public.tenant_domains enable row level security;
alter table public.user_profiles  enable row level security;

-- tenants: a member may read their tenant (writes happen via service_role).
create policy tenants_member_select on public.tenants
  for select to authenticated
  using ( id in (select public.auth_tenant_ids()) );

-- tenant_users: a member may read membership rows of their tenants.
create policy tenant_users_member_select on public.tenant_users
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );

-- tenant_domains: scoped to the owning tenant.
create policy tenant_domains_member_select on public.tenant_domains
  for select to authenticated
  using ( tenant_id in (select public.auth_tenant_ids()) );

-- user_profiles: a user sees and edits only their own row.
create policy user_profiles_self_select on public.user_profiles
  for select to authenticated
  using ( user_id = (select auth.uid()) );
create policy user_profiles_self_insert on public.user_profiles
  for insert to authenticated
  with check ( user_id = (select auth.uid()) );
create policy user_profiles_self_update on public.user_profiles
  for update to authenticated
  using ( user_id = (select auth.uid()) )
  with check ( user_id = (select auth.uid()) );
