-- ============================================================================
-- 20260621150000_referral_admin_allocation.sql
-- Make the personal invitation link (referral) a managed, premium-access
-- mechanic:
--
--   1. Decouple `referral_codes.status` from exhaustion. `status` now means
--      "admin-paused" only; "limit reached" is always DERIVED from
--      used >= allocation. This makes a clean admin suspend/reactivate possible
--      and lets a top-up automatically un-block an exhausted link.
--   2. Add a focused audit trail of admin allocation changes
--      (`referral_allocation_events`) alongside the platform-wide
--      `admin_audit_events`.
--   3. Add service-role RPCs the admin portal calls to search users, grant
--      more invitations (rewarding strong referrers), and suspend / reactivate
--      a link — each verifying the actor is an active admin and writing audit
--      evidence in the same transaction (mirrors admin_change_tenant_plan etc.).
--
-- Governance: governance/docs/product/access-and-invitations.md.
-- ============================================================================

-- --- 1. Decouple status from exhaustion -------------------------------------
-- Admin-pause context. `status` stays text active|suspended but now carries a
-- single meaning (admin paused). Exhaustion is never stored.
alter table public.referral_codes
  add column suspended_at     timestamptz,
  add column suspended_reason text,
  add column suspended_by     uuid references auth.users (id) on delete set null;

comment on column public.referral_codes.status is
  'Admin pause state only (active|suspended). "Limit reached" is derived from used >= allocation, never stored here.';

-- --- 2. Admin allocation event trail ----------------------------------------
-- One row per admin change to a user''s invitation budget or link state. This
-- is the per-user history the admin portal shows; the platform-wide trail in
-- admin_audit_events is written in the same transaction by the RPCs below.
create table public.referral_allocation_events (
  id               uuid primary key default gen_random_uuid(),
  referral_code_id uuid not null references public.referral_codes (id) on delete cascade,
  owner_user_id    uuid not null references auth.users (id) on delete cascade,
  actor_user_id    uuid references auth.users (id) on delete set null,
  event_type       text not null
                   check (event_type in ('allocation_increase', 'suspended', 'reactivated')),
  allocation_delta integer not null default 0,
  allocation_after integer not null,
  reason           text,
  created_at       timestamptz not null default now()
);

create index referral_allocation_events_code_idx
  on public.referral_allocation_events (referral_code_id, created_at desc);
create index referral_allocation_events_owner_idx
  on public.referral_allocation_events (owner_user_id, created_at desc);

-- Service-role only: written and read by trusted admin server code after an
-- explicit admin gate. RLS on as a backstop with no end-user policy (the owner
-- never sees admins'' internal notes).
grant all on table public.referral_allocation_events to service_role;
alter table public.referral_allocation_events enable row level security;

-- --- 3a. Rewrite reserve_referral: stop conflating suspended with exhausted --
-- No longer flips status to 'suspended' on exhaustion. Blocks when the link is
-- admin-suspended OR the allocation is spent, returning distinct outcomes so
-- the UI can show the right controlled message.
create or replace function public.reserve_referral(
  p_code text,
  p_referred_user_id uuid,
  p_referred_email text
)
returns table (usage_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code public.referral_codes%rowtype;
  v_existing public.referral_usages%rowtype;
  v_used integer;
  v_usage_id uuid;
begin
  select *
    into v_code
    from public.referral_codes
   where code = upper(trim(p_code))
   for update;

  if not found then
    return query select null::uuid, 'not_found'::text;
    return;
  end if;

  if v_code.owner_user_id = p_referred_user_id then
    return query select null::uuid, 'self_referral'::text;
    return;
  end if;

  -- Idempotent: a given referred user is only ever credited once per code.
  select *
    into v_existing
    from public.referral_usages
   where referral_code_id = v_code.id
     and referred_user_id = p_referred_user_id
   limit 1;

  if found then
    return query select v_existing.id, 'reserved'::text;
    return;
  end if;

  -- An admin pause blocks the link regardless of remaining allocation.
  if v_code.status = 'suspended' then
    return query select null::uuid, 'suspended'::text;
    return;
  end if;

  select count(*)::integer
    into v_used
    from public.referral_usages
   where referral_code_id = v_code.id;

  -- Allocation spent: blocked, but the link stays 'active' so a future top-up
  -- un-blocks it automatically (no manual reactivation needed).
  if v_used >= v_code.allocation then
    return query select null::uuid, 'exhausted'::text;
    return;
  end if;

  insert into public.referral_usages (
    referral_code_id,
    referrer_user_id,
    referred_user_id,
    referred_email,
    onboarding_status
  )
  values (
    v_code.id,
    v_code.owner_user_id,
    p_referred_user_id,
    p_referred_email,
    'pending'
  )
  returning id into v_usage_id;

  return query select v_usage_id, 'reserved'::text;
end;
$$;

revoke all on function public.reserve_referral(text, uuid, text) from public;
grant execute on function public.reserve_referral(text, uuid, text) to service_role;

-- --- 3b. Admin search over users + their invitation budget ------------------
-- Joins auth.users (not exposed via PostgREST), so it must be an RPC. Service
-- role only; the admin portal calls it after its admin gate. Blank query lists
-- the most recently created links.
create or replace function public.admin_referral_search(p_query text)
returns table (
  owner_user_id    uuid,
  email            text,
  display_name     text,
  referral_code_id uuid,
  code             text,
  allocation       integer,
  used             integer,
  remaining        integer,
  status           text,
  suspended_reason text,
  created_at       timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select
    rc.owner_user_id,
    au.email,
    up.display_name,
    rc.id as referral_code_id,
    rc.code,
    rc.allocation,
    coalesce(u.used, 0)::integer as used,
    greatest(0, rc.allocation - coalesce(u.used, 0))::integer as remaining,
    rc.status,
    rc.suspended_reason,
    rc.created_at
  from public.referral_codes rc
  join auth.users au on au.id = rc.owner_user_id
  left join public.user_profiles up on up.user_id = rc.owner_user_id
  left join lateral (
    select count(*)::integer as used
    from public.referral_usages ru
    where ru.referral_code_id = rc.id
  ) u on true
  where
    coalesce(trim(p_query), '') = ''
    or au.email ilike '%' || trim(p_query) || '%'
    or up.display_name ilike '%' || trim(p_query) || '%'
    or rc.code ilike '%' || trim(p_query) || '%'
  order by rc.created_at desc
  limit 50;
$$;

revoke all on function public.admin_referral_search(text) from public;
grant execute on function public.admin_referral_search(text) to service_role;

-- --- 3c. Grant additional invitations (reward strong referrers) -------------
create or replace function public.admin_grant_referral_allocation(
  p_owner_user_id uuid,
  p_additional integer,
  p_reason text,
  p_actor_user_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text;
  v_actor_roles text[];
  v_code public.referral_codes%rowtype;
  v_after integer;
  v_event_id uuid;
  v_audit_id uuid;
begin
  if p_additional is null or p_additional <= 0 or p_additional > 1000 then
    raise exception 'additional invitations must be between 1 and 1000'
      using errcode = '22023';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'reason must contain at least 5 characters'
      using errcode = '22023';
  end if;

  select actor_email, actor_roles
  into v_actor_email, v_actor_roles
  from public.admin_assert_actor(
    p_actor_user_id,
    array['admin_owner', 'admin_operations', 'admin_support']
  );

  select *
  into v_code
  from public.referral_codes
  where owner_user_id = p_owner_user_id
  for update;

  if v_code.id is null then
    raise exception 'referral code not found for user' using errcode = 'P0002';
  end if;

  v_after := v_code.allocation + p_additional;

  update public.referral_codes
  set allocation = v_after,
      updated_at = now()
  where id = v_code.id;

  insert into public.referral_allocation_events (
    referral_code_id, owner_user_id, actor_user_id,
    event_type, allocation_delta, allocation_after, reason
  )
  values (
    v_code.id, p_owner_user_id, p_actor_user_id,
    'allocation_increase', p_additional, v_after, trim(p_reason)
  )
  returning id into v_event_id;

  insert into public.admin_audit_events (
    actor_user_id, actor_email, actor_roles,
    action, entity_type, entity_id, tenant_id,
    before_state, after_state, reason, severity, correlation_id
  )
  values (
    p_actor_user_id, v_actor_email, v_actor_roles,
    'referral.allocation_increased', 'referral_code', v_code.id::text, v_code.tenant_id,
    jsonb_build_object('allocation', v_code.allocation),
    jsonb_build_object('allocation', v_after, 'added', p_additional),
    trim(p_reason), 'info', coalesce(p_correlation_id, gen_random_uuid())
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'ownerUserId', p_owner_user_id,
    'referralCodeId', v_code.id,
    'allocationAfter', v_after,
    'eventId', v_event_id,
    'auditEventId', v_audit_id
  );
end;
$$;

revoke all on function public.admin_grant_referral_allocation(uuid, integer, text, uuid, uuid) from public;
grant execute on function public.admin_grant_referral_allocation(uuid, integer, text, uuid, uuid) to service_role;

-- --- 3d. Suspend / reactivate a user's invitation link ----------------------
create or replace function public.admin_set_referral_suspension(
  p_owner_user_id uuid,
  p_suspend boolean,
  p_reason text,
  p_actor_user_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text;
  v_actor_roles text[];
  v_code public.referral_codes%rowtype;
  v_new_status text;
  v_event_id uuid;
  v_audit_id uuid;
begin
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'reason must contain at least 5 characters'
      using errcode = '22023';
  end if;

  select actor_email, actor_roles
  into v_actor_email, v_actor_roles
  from public.admin_assert_actor(
    p_actor_user_id,
    array['admin_owner', 'admin_operations']
  );

  select *
  into v_code
  from public.referral_codes
  where owner_user_id = p_owner_user_id
  for update;

  if v_code.id is null then
    raise exception 'referral code not found for user' using errcode = 'P0002';
  end if;

  v_new_status := case when p_suspend then 'suspended' else 'active' end;

  if v_code.status = v_new_status then
    raise exception 'invitation link already in the requested state'
      using errcode = '22023';
  end if;

  if p_suspend then
    update public.referral_codes
    set status = 'suspended',
        suspended_at = now(),
        suspended_reason = trim(p_reason),
        suspended_by = p_actor_user_id,
        updated_at = now()
    where id = v_code.id;
  else
    update public.referral_codes
    set status = 'active',
        suspended_at = null,
        suspended_reason = null,
        suspended_by = null,
        updated_at = now()
    where id = v_code.id;
  end if;

  insert into public.referral_allocation_events (
    referral_code_id, owner_user_id, actor_user_id,
    event_type, allocation_delta, allocation_after, reason
  )
  values (
    v_code.id, p_owner_user_id, p_actor_user_id,
    case when p_suspend then 'suspended' else 'reactivated' end,
    0, v_code.allocation, trim(p_reason)
  )
  returning id into v_event_id;

  insert into public.admin_audit_events (
    actor_user_id, actor_email, actor_roles,
    action, entity_type, entity_id, tenant_id,
    before_state, after_state, reason, severity, correlation_id
  )
  values (
    p_actor_user_id, v_actor_email, v_actor_roles,
    case when p_suspend then 'referral.suspended' else 'referral.reactivated' end,
    'referral_code', v_code.id::text, v_code.tenant_id,
    jsonb_build_object('status', v_code.status),
    jsonb_build_object('status', v_new_status),
    trim(p_reason),
    case when p_suspend then 'warn' else 'info' end,
    coalesce(p_correlation_id, gen_random_uuid())
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'ownerUserId', p_owner_user_id,
    'referralCodeId', v_code.id,
    'status', v_new_status,
    'eventId', v_event_id,
    'auditEventId', v_audit_id
  );
end;
$$;

revoke all on function public.admin_set_referral_suspension(uuid, boolean, text, uuid, uuid) from public;
grant execute on function public.admin_set_referral_suspension(uuid, boolean, text, uuid, uuid) to service_role;
