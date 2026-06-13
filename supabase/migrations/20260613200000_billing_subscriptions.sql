-- ============================================================================
-- 20260613200000_billing_subscriptions.sql
-- Billing & subscription foundation: per-tenant subscription state, the plan
-- registry (entitlement mirror), admin entitlement overrides, discounts
-- (founder/beta/coupon), rolled-up usage counters, and a provider-agnostic
-- webhook event ledger.
--
-- Governance: governance/billing-logical-design.md, governance/billing-technical-design.md (§2).
-- Builds ON TOP OF: 20260607160001_tenancy_core.sql (tenants, auth_tenant_ids()),
-- 20260613180000_admin_foundation.sql (catalogue_items, is_platform_admin(),
-- admin RBAC + audit), 20260613120000_tenant_model_providers.sql (BYO posture).
--
-- Source of truth: the *shape and defaults* of entitlements live in code
-- (app/modules/billing/plans.ts -> PLAN_ENTITLEMENTS). The DB carries a mirror
-- (subscription_plans.entitlements) for admin display and the marketing site;
-- runtime gating resolves from tenant_subscriptions, NOT from tenants.plan.
-- tenants.plan stays a denormalised convenience mirror of the active plan_key,
-- kept in sync by the same server path that writes tenant_subscriptions.
--
-- Isolation model (mirrors tenancy_core / admin_foundation):
--   * subscription_plans      — public catalogue: anon/authenticated read when
--                               public+active; platform admins read all; writes
--                               via service_role only.
--   * tenant_subscriptions,
--     tenant_entitlement_overrides,
--     subscription_discounts,
--     usage_counters          — TENANT-OWNED: members read their own rows via
--                               auth_tenant_ids(); platform admins read all;
--                               ALL writes via service_role (server actions).
--   * billing_events          — SERVER-ONLY (holds raw provider payloads):
--                               RLS enabled, NO authenticated policy, NO grant
--                               to authenticated/anon. Mirrors
--                               integration_credentials / tenant_model_providers.
-- ============================================================================

-- ============================================================================
-- 1. subscription_plans — plan registry + entitlement mirror
-- ============================================================================
-- One row per stable plan code. Binds the code to its catalogue item (display +
-- prices), an entitlement mirror (for admin/site), and trial config.
create table public.subscription_plans (
  plan_key          text primary key,                          -- 'plan_operator' | 'plan_executive' | 'plan_command' | 'plan_enterprise'
  catalogue_item_id uuid references public.catalogue_items(id) on delete set null,
  display_name      text not null,
  tier_rank         int  not null,                             -- ordering + upgrade/downgrade comparisons
  entitlements      jsonb not null default '{}'::jsonb,        -- mirror of PLAN_ENTITLEMENTS[plan_key]
  trial_days        int  not null default 0 check (trial_days >= 0),
  is_public         boolean not null default true,             -- shown on the marketing site
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger subscription_plans_set_updated_at before update on public.subscription_plans
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 2. tenant_subscriptions — one live subscription per tenant
-- ============================================================================
create table public.tenant_subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  plan_key                 text not null references public.subscription_plans(plan_key),
  status                   text not null default 'trialing'
                           check (status in ('trialing','active','past_due','grace','suspended','cancelled','expired')),
  billing_interval         text not null default 'month'
                           check (billing_interval in ('month','year')),
  -- Billing ownership: the tenant_users owner; denormalised here for quick lookup.
  owner_user_id            uuid references auth.users(id) on delete set null,
  -- Provider-agnostic references. 'manual' lets admin/invoice billing run before
  -- any payment provider is wired (see provider/manual adapter).
  provider                 text not null default 'manual'
                           check (provider in ('stripe','paddle','lemonsqueezy','manual')),
  provider_customer_id     text,
  provider_subscription_id text,
  -- Lifecycle timestamps.
  trial_ends_at            timestamptz,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  grace_ends_at            timestamptz,
  cancelled_at             timestamptz,
  -- Pricing context.
  currency                 text not null default 'USD',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
-- At most ONE live subscription per tenant; historical 'expired' rows are allowed.
create unique index tenant_subscriptions_one_active
  on public.tenant_subscriptions (tenant_id)
  where status in ('trialing','active','past_due','grace','suspended','cancelled');
create index tenant_subscriptions_status_idx
  on public.tenant_subscriptions (status, current_period_end);
create index tenant_subscriptions_provider_idx
  on public.tenant_subscriptions (provider, provider_subscription_id);
create trigger tenant_subscriptions_set_updated_at before update on public.tenant_subscriptions
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 3. tenant_entitlement_overrides — admin per-tenant overrides
-- ============================================================================
-- Highest-precedence layer in the resolver (plan defaults -> add-ons -> overrides).
-- value is typed by the entitlement_key (number | boolean | string).
create table public.tenant_entitlement_overrides (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  entitlement_key text not null,                               -- e.g. 'maxConnectedSources', 'canUseBYOAgent'
  value           jsonb not null,
  reason          text not null,
  expires_at      timestamptz,                                 -- null = permanent until removed
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index tenant_entitlement_overrides_tenant_idx
  on public.tenant_entitlement_overrides (tenant_id, entitlement_key);

-- ============================================================================
-- 4. subscription_discounts — founder / beta / coupon / manual
-- ============================================================================
-- Founder rate = kind 'founder', duration 'forever', status 'active': survives
-- upgrades + renewals; voided only by admin (status 'revoked', audited) or expiry.
create table public.subscription_discounts (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  kind               text not null check (kind in ('founder','beta','coupon','manual')),
  code               text,                                     -- coupon/invite code if applicable
  percent_off        int check (percent_off between 1 and 100),
  amount_off_cents   int check (amount_off_cents >= 0),
  currency           text default 'USD',
  duration           text not null default 'forever'
                     check (duration in ('once','repeating','forever')),
  duration_months    int check (duration_months > 0),          -- required when duration = 'repeating'
  provider_coupon_id text,                                     -- mirror into provider where supported
  status             text not null default 'active'
                     check (status in ('active','revoked','expired')),
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  expires_at         timestamptz,
  -- Exactly one of percent_off / amount_off_cents must be set.
  constraint subscription_discounts_one_amount check (
    (percent_off is not null)::int + (amount_off_cents is not null)::int = 1
  ),
  -- duration_months only meaningful for 'repeating'.
  constraint subscription_discounts_repeating_months check (
    (duration = 'repeating') = (duration_months is not null)
  )
);
create index subscription_discounts_tenant_idx
  on public.subscription_discounts (tenant_id, status);

-- ============================================================================
-- 5. usage_counters — rolled-up usage per metric per billing period
-- ============================================================================
-- Cheap-to-read aggregate the resolver + in-app meters consume. The per-call
-- ledgers remain authoritative (model_usage for AI; source_connections for
-- source counts); a scheduled job reconciles those into these counters.
create table public.usage_counters (
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  metric       text not null
               check (metric in ('ai_tokens','connected_sources','automations',
                                 'monitoring_events','file_uploads','briefings')),
  period_start date not null,                                  -- billing-period anchor (first day of period)
  used         numeric not null default 0 check (used >= 0),
  limit_value  numeric,                                        -- snapshot of effective limit at period start (null = unlimited)
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, metric, period_start)
);
create index usage_counters_tenant_idx
  on public.usage_counters (tenant_id, period_start desc);
create trigger usage_counters_set_updated_at before update on public.usage_counters
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 6. billing_events — provider webhook ledger (idempotent; SERVER-ONLY)
-- ============================================================================
create table public.billing_events (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references public.tenants(id) on delete set null,
  provider          text not null
                    check (provider in ('stripe','paddle','lemonsqueezy','manual')),
  provider_event_id text not null,                             -- idempotency key from the provider
  type              text not null,                             -- 'invoice.paid','subscription.updated','payment.failed', ...
  payload           jsonb not null,
  processed         boolean not null default false,
  processed_at      timestamptz,
  error             text,
  received_at       timestamptz not null default now(),
  unique (provider, provider_event_id)
);
create index billing_events_tenant_idx
  on public.billing_events (tenant_id, received_at desc);
create index billing_events_unprocessed_idx
  on public.billing_events (received_at) where not processed;

-- ============================================================================
-- Grants + RLS
-- ============================================================================

-- --- subscription_plans: public catalogue read + admin read; writes server-only.
alter table public.subscription_plans enable row level security;
grant select on table public.subscription_plans to anon, authenticated;
grant all    on table public.subscription_plans to service_role;
-- Public (site/app) read: only public, active plans.
create policy subscription_plans_public_select on public.subscription_plans
  for select to anon, authenticated
  using ( is_public = true and is_active = true );
-- Platform admins read everything (incl. internal/inactive plans).
create policy subscription_plans_admin_select on public.subscription_plans
  for select to authenticated
  using ( public.is_platform_admin() );

-- --- Tenant-owned tables: members read their own rows; admins read all;
--     writes via service_role (no authenticated write policies).
do $$
declare t text;
begin
  foreach t in array array[
    'tenant_subscriptions',
    'tenant_entitlement_overrides',
    'subscription_discounts',
    'usage_counters'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('grant select on table public.%I to authenticated;', t);
    execute format('grant all on table public.%I to service_role;', t);
    -- Member read, scoped to the caller's tenants.
    execute format(
      'create policy %I on public.%I for select to authenticated '
      || 'using ( tenant_id in (select public.auth_tenant_ids()) );',
      t || '_member_select', t);
    -- Platform admin read across all tenants.
    execute format(
      'create policy %I on public.%I for select to authenticated '
      || 'using ( public.is_platform_admin() );',
      t || '_admin_select', t);
  end loop;
end $$;

-- --- billing_events: SERVER-ONLY. RLS on, NO authenticated policy, NO grant to
--     authenticated/anon. Only service_role (BYPASSRLS) can touch it. Admin
--     reads go through Admin server actions under service_role. Mirrors the
--     integration_credentials / tenant_model_providers posture.
alter table public.billing_events enable row level security;
grant all on table public.billing_events to service_role;

-- ============================================================================
-- Seed: plan registry (entitlement mirror is intentionally minimal here — the
-- authoritative shape/defaults live in app/modules/billing/plans.ts and are
-- mirrored into subscription_plans.entitlements by the backfill/sync step in
-- Phase 1). catalogue_item_id is linked once the matching catalogue_items rows
-- exist (kind = 'plan'); left null here to avoid coupling to seed ordering.
-- ============================================================================
insert into public.subscription_plans (plan_key, display_name, tier_rank, trial_days, is_public, is_active) values
  ('plan_operator',   'Operator',                       10, 0,  true,  true),
  ('plan_executive',  'Executive',                      20, 14, true,  true),
  ('plan_command',    'Command',                        30, 0,  true,  true),
  ('plan_enterprise', 'Enterprise / Private Deployment',40, 0,  true,  true)
on conflict (plan_key) do nothing;

-- ============================================================================
-- Backfill note (NOT executed here — run as a server-side step in Phase 1 so it
-- can read PLAN_ENTITLEMENTS and the ops-chosen default plan):
--   For every existing tenant with status 'active', insert a tenant_subscriptions
--   row (provider 'manual', status 'active', plan_key = ops default e.g.
--   'plan_executive') so the resolver never locks out a current user. The
--   resolver treats a missing row as a grandfathered 'active' on the default
--   plan (logged) until backfill completes. See billing-technical-design.md §11.
-- ============================================================================
