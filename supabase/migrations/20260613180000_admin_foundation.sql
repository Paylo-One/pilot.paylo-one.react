-- ============================================================================
-- 20260613180000_admin_foundation.sql
-- Admin portal foundation: platform-level admin identity + roles (RBAC), the
-- catalogue (items + prices), billing requests, onboarding requests, internal
-- notes, and a platform-level admin audit trail. Plus the RLS helpers
-- is_platform_admin() / admin_has_role().
--
-- Governance: governance/docs/decisions/architecture-decisions.md (ADR-042),
-- admin/docs/auth-and-rbac.md, admin/docs/data-model.md.
--
-- This migration lives in the APP repo (app/supabase/migrations) — the single
-- source of truth for the shared Postgres — even though the tables it creates
-- are owned by the separate Admin portal (admin/). The Admin app is a separate
-- deployable but manages platform data that lives in this same database. The
-- migration reuses the existing public.set_updated_at() trigger and the
-- tenants/auth.users tables; it does NOT duplicate tenant-scoped concepts.
--
-- Isolation model: admin tables are PLATFORM-level (no tenant_id). End-user
-- (tenant) sessions can never read them — RLS gates every read on
-- is_platform_admin(). All writes go through the Admin server actions using the
-- secret key (service_role) AFTER an explicit server-side role check; the
-- authenticated grant is read-only. The one exception is catalogue items marked
-- visibility = 'public', which the app/site may read for display + billing.
-- ============================================================================

-- --- Admin identity & RBAC --------------------------------------------------

-- A person authorised to use the Admin portal. Identity comes from Supabase
-- Auth (Microsoft Entra ID federated as the 'azure' provider); this row marks
-- that auth user as a platform admin and carries their lifecycle status.
create table public.admin_users (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text,
  status       text not null default 'active'
               check (status in ('active','suspended')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger admin_users_set_updated_at before update on public.admin_users
  for each row execute function public.set_updated_at();

-- The fixed registry of admin roles. Seeded below; ranked so the UI can order
-- them and reason about privilege without hard-coding strings everywhere.
create table public.admin_roles (
  role_key    text primary key,
  label       text not null,
  description text not null,
  rank        int  not null,
  created_at  timestamptz not null default now()
);

-- Role assignments (many-to-many): one admin may hold several roles.
create table public.admin_user_roles (
  user_id     uuid not null references public.admin_users(user_id) on delete cascade,
  role_key    text not null references public.admin_roles(role_key) on delete restrict,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_key)
);

-- Seed the initial role registry (RBAC from day one; some unused for now).
insert into public.admin_roles (role_key, label, description, rank) values
  ('admin_owner',      'Owner',      'Full control, including managing admin users and roles.', 100),
  ('admin_operations', 'Operations', 'Manage catalogue, onboarding, and day-to-day operations.', 80),
  ('admin_finance',    'Finance',    'Manage billing requests, pricing, and payment reviews.',   70),
  ('admin_support',    'Support',    'View and triage requests; add notes; limited actions.',    50),
  ('admin_readonly',   'Read only',  'Read-only access across the portal.',                       10);

-- --- Catalogue (items + prices) ---------------------------------------------

-- A catalogue item: a plan, product, or add-on shown publicly and billed.
-- Features and arbitrary display/billing metadata are JSONB so the shape can
-- evolve without a migration per field.
create table public.catalogue_items (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,                       -- stable code, e.g. 'plan_pro'
  name         text not null,
  kind         text not null default 'plan'
               check (kind in ('plan','product','addon')),
  description  text,
  features     jsonb not null default '[]'::jsonb,          -- ["Daily Memo", "People Context", ...]
  metadata     jsonb not null default '{}'::jsonb,          -- public-display + billing metadata
  availability text not null default 'planned'
               check (availability in ('available','planned','coming_soon','retired')),
  visibility   text not null default 'internal'
               check (visibility in ('public','internal')),
  is_enabled   boolean not null default false,             -- master on/off switch
  sort_order   int not null default 0,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger catalogue_items_set_updated_at before update on public.catalogue_items
  for each row execute function public.set_updated_at();

-- A price for a catalogue item. An item may carry several (currency × interval).
create table public.catalogue_prices (
  id                uuid primary key default gen_random_uuid(),
  catalogue_item_id uuid not null references public.catalogue_items(id) on delete cascade,
  currency          text not null default 'USD',
  interval          text not null default 'month'
                    check (interval in ('month','year','one_time')),
  amount_cents      int not null check (amount_cents >= 0),
  label             text,
  is_active         boolean not null default true,
  metadata          jsonb not null default '{}'::jsonb,     -- e.g. external billing ids (TODO: wire)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger catalogue_prices_set_updated_at before update on public.catalogue_prices
  for each row execute function public.set_updated_at();
create index catalogue_prices_item_idx on public.catalogue_prices (catalogue_item_id);

-- --- Billing requests --------------------------------------------------------

create table public.billing_requests (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid references public.tenants(id) on delete set null, -- nullable: may predate a tenant
  kind                  text not null default 'other'
                        check (kind in ('new_setup','subscription_change','payment_review','failed_billing','other')),
  status                text not null default 'open'
                        check (status in ('open','in_review','resolved','rejected','needs_follow_up')),
  summary               text not null,
  details               jsonb not null default '{}'::jsonb,
  contact_email         text,
  requested_by_user_id  uuid references auth.users(id) on delete set null,
  assigned_admin_user_id uuid references public.admin_users(user_id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  resolved_at           timestamptz
);
create trigger billing_requests_set_updated_at before update on public.billing_requests
  for each row execute function public.set_updated_at();
create index billing_requests_status_idx on public.billing_requests (status, created_at desc);

-- --- Onboarding requests -----------------------------------------------------
-- A fuller onboarding workflow than the marketing-side access_requests table.
-- It does NOT duplicate that capture: link back via access_request_id when an
-- onboarding case originates from a landing-page request.
create table public.onboarding_requests (
  id                     uuid primary key default gen_random_uuid(),
  access_request_id      uuid references public.access_requests(id) on delete set null,
  business_name          text not null,
  contact_name           text,
  contact_email          text not null,
  requested_item_id      uuid references public.catalogue_items(id) on delete set null,
  details                jsonb not null default '{}'::jsonb,    -- business/customer details
  status                 text not null default 'new'
                         check (status in ('new','in_review','info_requested','approved','rejected','provisioning','completed')),
  assigned_admin_user_id uuid references public.admin_users(user_id) on delete set null,
  tenant_id              uuid references public.tenants(id) on delete set null, -- set once provisioned
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  decided_at             timestamptz,
  decided_by             uuid references auth.users(id) on delete set null
);
create trigger onboarding_requests_set_updated_at before update on public.onboarding_requests
  for each row execute function public.set_updated_at();
create index onboarding_requests_status_idx on public.onboarding_requests (status, created_at desc);

-- --- Internal notes (shared by billing + onboarding) -------------------------
create table public.admin_notes (
  id              uuid primary key default gen_random_uuid(),
  entity_type     text not null
                  check (entity_type in ('billing_request','onboarding_request','catalogue_item')),
  entity_id       uuid not null,
  author_user_id  uuid references auth.users(id) on delete set null,
  body            text not null,
  created_at      timestamptz not null default now()
);
create index admin_notes_entity_idx on public.admin_notes (entity_type, entity_id, created_at desc);

-- --- Admin audit trail (platform-level; NOT tenant-scoped) -------------------
-- The app's audit_events is tenant-scoped (tenant_id NOT NULL) and cannot hold
-- platform actions like "approved onboarding request" or "disabled a plan".
create table public.admin_audit_events (
  id             uuid primary key default gen_random_uuid(),
  actor_user_id  uuid references auth.users(id) on delete set null,
  action         text not null,                         -- e.g. 'catalogue.item.disabled'
  entity_type    text,                                  -- e.g. 'catalogue_item'
  entity_id      text,
  metadata       jsonb,
  occurred_at    timestamptz not null default now()
);
create index admin_audit_events_actor_idx  on public.admin_audit_events (actor_user_id, occurred_at desc);
create index admin_audit_events_entity_idx on public.admin_audit_events (entity_type, entity_id, occurred_at desc);
create index admin_audit_events_time_idx   on public.admin_audit_events (occurred_at desc);

-- ============================================================================
-- RLS helpers
-- ============================================================================

-- True when the current auth user is an active platform admin. SECURITY DEFINER
-- + locked search_path so policies can call it without RLS recursion (mirrors
-- public.auth_tenant_ids()).
create or replace function public.is_platform_admin()
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users au
    where au.user_id = (select auth.uid()) and au.status = 'active'
  )
$$;
revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated, service_role;

-- True when the current active admin holds a specific role.
create or replace function public.admin_has_role(target_role text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users au
    join public.admin_user_roles ur on ur.user_id = au.user_id
    where au.user_id = (select auth.uid())
      and au.status = 'active'
      and ur.role_key = target_role
  )
$$;
revoke all on function public.admin_has_role(text) from public;
grant execute on function public.admin_has_role(text) to authenticated, service_role;

-- ============================================================================
-- Grants + RLS
-- Admin tables: authenticated may READ only when is_platform_admin(); all
-- writes go through the service_role (Admin server actions). The service_role
-- bypasses RLS, so no write policies are defined for authenticated.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'admin_users','admin_roles','admin_user_roles',
    'catalogue_items','catalogue_prices',
    'billing_requests','onboarding_requests','admin_notes','admin_audit_events'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('grant select on table public.%I to authenticated;', t);
    execute format('grant all on table public.%I to service_role;', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ( public.is_platform_admin() );',
      t || '_admin_select', t);
  end loop;
end $$;

-- Public catalogue read: the app/site may show enabled, public, non-retired
-- items (and their active prices) for display + billing. Admins still see all
-- via the *_admin_select policies above.
grant select on table public.catalogue_items  to anon;
grant select on table public.catalogue_prices to anon;

create policy catalogue_items_public_select on public.catalogue_items
  for select to anon, authenticated
  using ( visibility = 'public' and is_enabled = true and availability <> 'retired' );

create policy catalogue_prices_public_select on public.catalogue_prices
  for select to anon, authenticated
  using (
    is_active = true
    and exists (
      select 1 from public.catalogue_items ci
      where ci.id = catalogue_prices.catalogue_item_id
        and ci.visibility = 'public'
        and ci.is_enabled = true
        and ci.availability <> 'retired'
    )
  );

-- ============================================================================
-- Bootstrap the first owner (run ONCE, manually, after the person has signed
-- in through Entra at least once so their auth.users row exists).
-- Do NOT hard-code a user id or email in this migration. See
-- admin/docs/auth-and-rbac.md "Bootstrapping the first admin".
--
--   with u as (select id, email from auth.users where email = 'YOU@paylo.one')
--   insert into public.admin_users (user_id, email, display_name, status)
--   select id, email, 'Your Name', 'active' from u;
--   insert into public.admin_user_roles (user_id, role_key, assigned_by)
--   select u.id, 'admin_owner', u.id from (select id from auth.users where email = 'YOU@paylo.one') u;
-- ============================================================================
