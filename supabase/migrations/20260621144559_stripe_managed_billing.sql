-- ============================================================================
-- Stripe Managed Billing
--
-- Adds Stripe-specific billing state beside the existing provider-agnostic
-- tenant_subscriptions model. Stripe remains the payment source of truth;
-- billing_access is the local access-control projection used by the app shell.
-- ============================================================================

-- Seven days of free access for invited operators. Prepared-owner activation
-- reads this value when the owner accepts the invitation.
update public.subscription_plans
set trial_days = 7,
    updated_at = now()
where plan_key = 'plan_operator';

-- The existing lifecycle vocabulary was provider-agnostic. Stripe introduces
-- "unpaid" and "incomplete"; they should collapse to restricted access.
alter table public.tenant_subscriptions
  drop constraint if exists tenant_subscriptions_status_check;

alter table public.tenant_subscriptions
  add constraint tenant_subscriptions_status_check
  check (status in (
    'trialing',
    'active',
    'past_due',
    'grace',
    'suspended',
    'cancelled',
    'unpaid',
    'incomplete',
    'expired'
  ));

alter table public.tenant_subscriptions
  add column if not exists stripe_product_id text,
  add column if not exists stripe_price_id text,
  add column if not exists last_payment_status text,
  add column if not exists last_payment_error text,
  add column if not exists last_stripe_event_id text;

create index if not exists tenant_subscriptions_stripe_customer_idx
  on public.tenant_subscriptions (provider_customer_id)
  where provider = 'stripe';

-- --- Stripe customer ownership ---------------------------------------------

create table if not exists public.billing_customers (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  user_id            uuid references auth.users(id) on delete set null,
  stripe_customer_id text not null unique,
  email              text,
  name               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id)
);

drop trigger if exists billing_customers_set_updated_at on public.billing_customers;
create trigger billing_customers_set_updated_at before update on public.billing_customers
  for each row execute function public.set_updated_at();

create index if not exists billing_customers_user_idx
  on public.billing_customers (user_id);

-- --- Stripe subscription projection ----------------------------------------

create table if not exists public.billing_subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  user_id                  uuid references auth.users(id) on delete set null,
  stripe_customer_id       text not null,
  stripe_subscription_id   text not null unique,
  stripe_price_id          text,
  stripe_product_id        text,
  stripe_status            text not null,
  billing_status           text not null
                           check (billing_status in (
                             'trialing',
                             'active',
                             'past_due',
                             'unpaid',
                             'canceled',
                             'incomplete',
                             'expired'
                           )),
  access_status            text not null
                           check (access_status in ('active', 'restricted')),
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  last_payment_status      text,
  last_payment_error       text,
  last_stripe_event_id     text,
  raw                      jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

drop trigger if exists billing_subscriptions_set_updated_at on public.billing_subscriptions;
create trigger billing_subscriptions_set_updated_at before update on public.billing_subscriptions
  for each row execute function public.set_updated_at();

create index if not exists billing_subscriptions_tenant_idx
  on public.billing_subscriptions (tenant_id, updated_at desc);
create index if not exists billing_subscriptions_customer_idx
  on public.billing_subscriptions (stripe_customer_id);
create index if not exists billing_subscriptions_status_idx
  on public.billing_subscriptions (billing_status, access_status);

-- --- Local access-control projection ---------------------------------------

create table if not exists public.billing_access (
  tenant_id                  uuid primary key references public.tenants(id) on delete cascade,
  user_id                    uuid references auth.users(id) on delete set null,
  billing_status             text not null default 'trialing'
                             check (billing_status in (
                               'trialing',
                               'active',
                               'past_due',
                               'unpaid',
                               'canceled',
                               'incomplete',
                               'expired'
                             )),
  access_status              text not null default 'active'
                             check (access_status in ('active', 'restricted')),
  free_access_started_at     timestamptz not null default now(),
  free_access_ends_at        timestamptz not null default (now() + interval '7 days'),
  stripe_customer_id         text,
  stripe_subscription_id     text,
  stripe_checkout_session_id text,
  stripe_product_id          text,
  stripe_price_id            text,
  current_period_start       timestamptz,
  current_period_end         timestamptz,
  cancel_at_period_end       boolean not null default false,
  last_payment_status        text,
  last_payment_error         text,
  last_stripe_event_id       text,
  manual_override            text check (manual_override in ('extend_free_access', 'restrict_access', 'restore_access_after_manual_review')),
  manual_override_reason     text,
  manual_override_until      timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

drop trigger if exists billing_access_set_updated_at on public.billing_access;
create trigger billing_access_set_updated_at before update on public.billing_access
  for each row execute function public.set_updated_at();

create index if not exists billing_access_status_idx
  on public.billing_access (billing_status, access_status);
create index if not exists billing_access_stripe_customer_idx
  on public.billing_access (stripe_customer_id)
  where stripe_customer_id is not null;
create index if not exists billing_access_stripe_subscription_idx
  on public.billing_access (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- --- Admin operational notes and billing-specific audit ---------------------

create table if not exists public.billing_admin_notes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.tenants(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  admin_user_id uuid references auth.users(id) on delete set null,
  note          text not null check (length(trim(note)) >= 3),
  created_at    timestamptz not null default now()
);

create index if not exists billing_admin_notes_tenant_idx
  on public.billing_admin_notes (tenant_id, created_at desc);

create table if not exists public.billing_audit_log (
  id               uuid primary key default gen_random_uuid(),
  admin_user_id    uuid references auth.users(id) on delete set null,
  action           text not null,
  target_user_id   uuid references auth.users(id) on delete set null,
  target_tenant_id uuid references public.tenants(id) on delete set null,
  previous_state   jsonb,
  new_state        jsonb,
  reason           text not null,
  created_at       timestamptz not null default now()
);

create index if not exists billing_audit_log_tenant_idx
  on public.billing_audit_log (target_tenant_id, created_at desc);
create index if not exists billing_audit_log_admin_idx
  on public.billing_audit_log (admin_user_id, created_at desc);

alter table public.billing_events
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;

create index if not exists billing_events_stripe_customer_idx
  on public.billing_events (stripe_customer_id, received_at desc)
  where stripe_customer_id is not null;
create index if not exists billing_events_stripe_subscription_idx
  on public.billing_events (stripe_subscription_id, received_at desc)
  where stripe_subscription_id is not null;

-- --- RLS and grants ---------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'billing_customers',
    'billing_subscriptions',
    'billing_access',
    'billing_admin_notes',
    'billing_audit_log'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('grant all on table public.%I to service_role;', t);
  end loop;
end $$;

grant select on table public.billing_customers to authenticated;
grant select on table public.billing_subscriptions to authenticated;
grant select on table public.billing_access to authenticated;
grant select on table public.billing_admin_notes to authenticated;
grant select on table public.billing_audit_log to authenticated;

create policy billing_customers_member_select on public.billing_customers
  for select to authenticated
  using (tenant_id in (select public.auth_tenant_ids()));
create policy billing_customers_admin_select on public.billing_customers
  for select to authenticated
  using (public.is_platform_admin());

create policy billing_subscriptions_member_select on public.billing_subscriptions
  for select to authenticated
  using (tenant_id in (select public.auth_tenant_ids()));
create policy billing_subscriptions_admin_select on public.billing_subscriptions
  for select to authenticated
  using (public.is_platform_admin());

create policy billing_access_member_select on public.billing_access
  for select to authenticated
  using (tenant_id in (select public.auth_tenant_ids()));
create policy billing_access_admin_select on public.billing_access
  for select to authenticated
  using (public.is_platform_admin());

create policy billing_admin_notes_admin_select on public.billing_admin_notes
  for select to authenticated
  using (public.is_platform_admin());
create policy billing_audit_log_admin_select on public.billing_audit_log
  for select to authenticated
  using (public.is_platform_admin());
