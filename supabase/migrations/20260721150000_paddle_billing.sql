-- ============================================================================
-- 20260721150000_paddle_billing.sql
-- Paddle fulfilment mirror: Paddle customer registry, staging for anonymous
-- (marketing-site) checkouts, and Paddle-specific columns on the existing
-- provider-agnostic tenant_subscriptions projection.
--
-- Builds ON TOP OF: 20260613200000_billing_subscriptions.sql (billing_events,
-- tenant_subscriptions with provider 'paddle' already in the enum),
-- 20260621144559_stripe_managed_billing.sql (Stripe posture this mirrors),
-- 20260715120000_tenant_access_lifecycle.sql (ADR-053: tenants.status is the
-- SOLE access authority — nothing here suspends or reactivates a tenant).
--
-- Anonymous-checkout posture: the marketing site opens Paddle overlay checkout
-- with NO custom_data, so a webhook can arrive before any tenant exists. The
-- Paddle customer is mirrored with tenant_id NULL and the subscription is
-- staged in paddle_subscriptions_unlinked; linking happens later by matching
-- the registration email (or custom_data.tenant_id when present) and PROMOTES
-- the staged row into tenant_subscriptions. Staged rows are never deleted —
-- they are marked promoted (they are fulfilment state, not test litter).
--
-- Isolation model: both new tables hold raw provider state and are
-- SERVER-ONLY — RLS enabled, NO end-user policies, NO grants to
-- authenticated/anon. Mirrors the billing_events posture.
-- ============================================================================

-- ============================================================================
-- 1. paddle_customers — Paddle customer registry (tenant link may lag)
-- ============================================================================
-- tenant_id is NULLABLE ON PURPOSE: marketing-site checkouts are anonymous, so
-- the customer arrives before a tenant exists. Linking happens later via
-- custom_data.tenant_id or by matching the registration email.
create table public.paddle_customers (
  customer_id text primary key,                                 -- Paddle ctm_...
  email       text not null,
  tenant_id   uuid references public.tenants(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index paddle_customers_email_idx
  on public.paddle_customers (lower(email));
create index paddle_customers_tenant_idx
  on public.paddle_customers (tenant_id)
  where tenant_id is not null;
create trigger paddle_customers_set_updated_at before update on public.paddle_customers
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 2. paddle_subscriptions_unlinked — staging for subscriptions whose customer
--    has no tenant yet (tenant_subscriptions.tenant_id is NOT NULL)
-- ============================================================================
-- Rows are PROMOTED into tenant_subscriptions when the customer gets linked
-- (linkPaddleCustomerToTenant); promoted rows are kept and stamped, not deleted.
create table public.paddle_subscriptions_unlinked (
  subscription_id            text primary key,                  -- Paddle sub_...
  customer_id                text not null,
  status                     text not null,                     -- raw Paddle status
  price_id                   text,
  product_id                 text,
  billing_interval           text not null default 'month'
                             check (billing_interval in ('month','year')),
  currency                   text,
  trial_ends_at              timestamptz,
  current_period_start       timestamptz,
  current_period_end         timestamptz,
  cancelled_at               timestamptz,
  scheduled_change_action    text
                             check (scheduled_change_action is null
                                    or scheduled_change_action in ('cancel','pause','resume')),
  scheduled_change_effective_at timestamptz,
  scheduled_change_resume_at timestamptz,
  -- Out-of-order delivery guard: only events newer than this are applied.
  last_event_id              text,
  last_event_occurred_at     timestamptz,
  payload                    jsonb not null default '{}'::jsonb,
  promoted_tenant_id         uuid references public.tenants(id) on delete set null,
  promoted_at                timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
create index paddle_subscriptions_unlinked_customer_idx
  on public.paddle_subscriptions_unlinked (customer_id)
  where promoted_at is null;
create trigger paddle_subscriptions_unlinked_set_updated_at
  before update on public.paddle_subscriptions_unlinked
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 3. tenant_subscriptions — Paddle mirror columns
-- ============================================================================
-- Paddle statuses map into the EXISTING vocabulary (no new states):
--   trialing → trialing, active → active, past_due → past_due,
--   canceled → cancelled, paused → suspended (closest non-access-granting
--   state; deliberate — see modules/billing/paddle-status.ts).
alter table public.tenant_subscriptions
  add column if not exists paddle_price_id text,
  add column if not exists paddle_product_id text,
  add column if not exists scheduled_change_action text
    check (scheduled_change_action is null
           or scheduled_change_action in ('cancel','pause','resume')),
  add column if not exists scheduled_change_effective_at timestamptz,
  add column if not exists scheduled_change_resume_at timestamptz,
  add column if not exists last_paddle_event_id text,
  -- Out-of-order delivery guard (Paddle delivers at-least-once, unordered).
  add column if not exists last_paddle_event_occurred_at timestamptz;

create index if not exists tenant_subscriptions_paddle_customer_idx
  on public.tenant_subscriptions (provider_customer_id)
  where provider = 'paddle';

-- ============================================================================
-- Grants + RLS: SERVER-ONLY (raw provider state). RLS on, no authenticated or
-- anon policies/grants; only service_role (BYPASSRLS) may touch these tables.
-- ============================================================================
alter table public.paddle_customers enable row level security;
grant all on table public.paddle_customers to service_role;

alter table public.paddle_subscriptions_unlinked enable row level security;
grant all on table public.paddle_subscriptions_unlinked to service_role;
