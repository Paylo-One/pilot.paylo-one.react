-- ============================================================================
-- 20260613140000_referrals.sql
-- Per-user referral model (replaces the email-send beta invitations in the user
-- app). Each user gets ONE unique referral code with an allocation of invitation
-- uses (default 5). Anyone with the link can use it during onboarding; each
-- successful signup records a usage and decrements the remaining count. When the
-- allocation is exhausted the code is suspended and can no longer be used.
--
-- Conventions mirror the rest of the schema: explicit grants, RLS on every
-- table, owner-scoped end-user reads, and all writes (creation, consumption,
-- suspension, top-ups) performed server-side with the service role. The audit
-- trail reuses the existing `audit_events` table (referral.created / used /
-- suspended / topped_up).
-- Governance: governance/docs/product/access-and-invitations.md.
-- ============================================================================

-- --- referral_codes ---------------------------------------------------------
-- One row per user. `allocation` is the only place the limit lives — never
-- hardcode it in the UI — so it can be raised for selected users later without
-- a model change. `status` flips to 'suspended' once usage reaches allocation.
create table public.referral_codes (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users (id) on delete cascade,
  tenant_id     uuid references public.tenants (id) on delete set null,
  code          text not null unique,
  allocation    integer not null default 5 check (allocation >= 0),
  status        text not null default 'active' check (status in ('active', 'suspended')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index referral_codes_owner_idx on public.referral_codes (owner_user_id);

-- --- referral_usages --------------------------------------------------------
-- One row per signup that used a code. Links referrer -> referred user/tenant.
-- "Account status" shown to the referrer is derived (a referred_tenant_id means
-- they have a live workspace), so no status snapshot is stored here.
create table public.referral_usages (
  id                uuid primary key default gen_random_uuid(),
  referral_code_id  uuid not null references public.referral_codes (id) on delete cascade,
  referrer_user_id  uuid not null references auth.users (id) on delete cascade,
  referred_user_id  uuid references auth.users (id) on delete set null,
  referred_email    text,
  referred_tenant_id uuid references public.tenants (id) on delete set null,
  onboarding_status text not null default 'completed'
                    check (onboarding_status in ('pending', 'completed', 'expired')),
  created_at        timestamptz not null default now()
);

create index referral_usages_code_idx
  on public.referral_usages (referral_code_id, created_at desc);
create index referral_usages_referrer_idx
  on public.referral_usages (referrer_user_id, created_at desc);

-- A given referred user can only be credited once per code (idempotent consume).
create unique index referral_usages_unique_referred
  on public.referral_usages (referral_code_id, referred_user_id)
  where referred_user_id is not null;

-- --- grants -----------------------------------------------------------------
grant select on table public.referral_codes  to authenticated;
grant all    on table public.referral_codes  to service_role;
grant select on table public.referral_usages to authenticated;
grant all    on table public.referral_usages to service_role;

-- --- RLS --------------------------------------------------------------------
alter table public.referral_codes  enable row level security;
alter table public.referral_usages enable row level security;

-- A user may read their own referral code and the usages of that code. All
-- writes (creation, cross-user consumption, suspension) go through the service
-- role, so there are deliberately no INSERT/UPDATE policies here.
create policy referral_codes_owner_select on public.referral_codes
  for select to authenticated
  using (owner_user_id = (select auth.uid()));

create policy referral_usages_referrer_select on public.referral_usages
  for select to authenticated
  using (referrer_user_id = (select auth.uid()));
