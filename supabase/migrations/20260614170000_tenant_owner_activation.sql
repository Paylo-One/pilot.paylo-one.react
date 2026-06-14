-- ============================================================================
-- 20260614170000_tenant_owner_activation.sql
-- One-time owner activation for tenants prepared by the Admin portal.
--
-- The Admin portal issues a random activation token but stores only its
-- SHA-256 hash. The invited person verifies their identity through Supabase
-- Auth, accepts the legal terms in the app, and then claims the prepared
-- workspace. Owner membership, primary domain, profile, subscription dates,
-- tenant state, onboarding state, and audit evidence commit atomically.
-- ============================================================================

create table public.tenant_activation_invitations (
  id                    uuid primary key default gen_random_uuid(),
  onboarding_request_id uuid not null unique
                        references public.onboarding_requests(id) on delete cascade,
  tenant_id             uuid not null
                        references public.tenants(id) on delete cascade,
  email                 text not null,
  token_hash            bytea not null unique,
  status                text not null default 'pending'
                        check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at            timestamptz not null,
  issued_by             uuid references auth.users(id) on delete set null,
  issued_at             timestamptz not null default now(),
  accepted_at           timestamptz,
  accepted_user_id      uuid references auth.users(id) on delete set null,
  revoked_at            timestamptz
);

create index tenant_activation_invitations_status_idx
  on public.tenant_activation_invitations (status, expires_at);
create index tenant_activation_invitations_tenant_idx
  on public.tenant_activation_invitations (tenant_id, issued_at desc);

alter table public.tenant_activation_invitations enable row level security;
grant select on table public.tenant_activation_invitations to authenticated;
grant all on table public.tenant_activation_invitations to service_role;

create policy tenant_activation_invitations_admin_select
  on public.tenant_activation_invitations
  for select to authenticated
  using (public.is_platform_admin());

-- --- Admin issue/reissue ----------------------------------------------------

create or replace function public.admin_issue_tenant_activation(
  p_onboarding_request_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
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
  v_onboarding public.onboarding_requests%rowtype;
  v_tenant public.tenants%rowtype;
  v_existing public.tenant_activation_invitations%rowtype;
  v_invitation_id uuid;
  v_audit_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'reason must contain at least 10 characters'
      using errcode = '22023';
  end if;

  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'activation token hash is invalid' using errcode = '22023';
  end if;

  if p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception 'activation expiry must be within the next 30 days'
      using errcode = '22023';
  end if;

  select actor_email, actor_roles
  into v_actor_email, v_actor_roles
  from public.admin_assert_actor(
    p_actor_user_id,
    array['admin_owner', 'admin_operations']
  );

  select *
  into v_onboarding
  from public.onboarding_requests
  where id = p_onboarding_request_id
  for update;

  if v_onboarding.id is null then
    raise exception 'onboarding request not found' using errcode = 'P0002';
  end if;

  if v_onboarding.status <> 'provisioning' or v_onboarding.tenant_id is null then
    raise exception 'onboarding request is not awaiting owner activation'
      using errcode = '22023';
  end if;

  select *
  into v_tenant
  from public.tenants
  where id = v_onboarding.tenant_id
  for update;

  if v_tenant.id is null or v_tenant.status <> 'provisioning' then
    raise exception 'tenant is not awaiting activation' using errcode = '22023';
  end if;

  select *
  into v_existing
  from public.tenant_activation_invitations
  where onboarding_request_id = v_onboarding.id
  for update;

  if v_existing.id is not null and v_existing.status = 'accepted' then
    raise exception 'workspace owner has already activated'
      using errcode = '22023';
  end if;

  if v_existing.id is null then
    v_before := null;
    insert into public.tenant_activation_invitations (
      onboarding_request_id,
      tenant_id,
      email,
      token_hash,
      status,
      expires_at,
      issued_by
    )
    values (
      v_onboarding.id,
      v_tenant.id,
      lower(trim(v_onboarding.contact_email)),
      decode(p_token_hash, 'hex'),
      'pending',
      p_expires_at,
      p_actor_user_id
    )
    returning id into v_invitation_id;
  else
    v_before := jsonb_build_object(
      'invitationId', v_existing.id,
      'status', v_existing.status,
      'expiresAt', v_existing.expires_at,
      'issuedAt', v_existing.issued_at
    );

    update public.tenant_activation_invitations
    set email = lower(trim(v_onboarding.contact_email)),
        token_hash = decode(p_token_hash, 'hex'),
        status = 'pending',
        expires_at = p_expires_at,
        issued_by = p_actor_user_id,
        issued_at = now(),
        accepted_at = null,
        accepted_user_id = null,
        revoked_at = null
    where id = v_existing.id
    returning id into v_invitation_id;
  end if;

  update public.onboarding_requests
  set details = details || jsonb_build_object(
        'provisioningStage', 'awaiting_owner_acceptance',
        'activationInvitationId', v_invitation_id
      ),
      updated_at = now()
  where id = v_onboarding.id;

  if v_onboarding.access_request_id is not null then
    update public.access_requests
    set status = 'invited',
        updated_at = now()
    where id = v_onboarding.access_request_id;
  end if;

  v_after := jsonb_build_object(
    'invitationId', v_invitation_id,
    'status', 'pending',
    'email', lower(trim(v_onboarding.contact_email)),
    'expiresAt', p_expires_at,
    'provisioningStage', 'awaiting_owner_acceptance'
  );

  insert into public.admin_audit_events (
    actor_user_id,
    actor_email,
    actor_roles,
    action,
    entity_type,
    entity_id,
    tenant_id,
    before_state,
    after_state,
    reason,
    severity,
    correlation_id
  )
  values (
    p_actor_user_id,
    v_actor_email,
    v_actor_roles,
    case when v_existing.id is null
      then 'onboarding.owner_activation_issued'
      else 'onboarding.owner_activation_reissued'
    end,
    'onboarding_request',
    v_onboarding.id::text,
    v_tenant.id,
    v_before,
    v_after,
    trim(p_reason),
    'info',
    coalesce(p_correlation_id, gen_random_uuid())
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'invitationId', v_invitation_id,
    'tenantId', v_tenant.id,
    'onboardingRequestId', v_onboarding.id,
    'expiresAt', p_expires_at,
    'auditEventId', v_audit_id
  );
end;
$$;

revoke all on function public.admin_issue_tenant_activation(
  uuid, text, timestamptz, text, uuid, uuid
) from public;
grant execute on function public.admin_issue_tenant_activation(
  uuid, text, timestamptz, text, uuid, uuid
) to service_role;

-- --- Customer owner claim --------------------------------------------------

create or replace function public.activate_prepared_tenant(
  p_token_hash text,
  p_user_id uuid,
  p_display_name text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.tenant_activation_invitations%rowtype;
  v_onboarding public.onboarding_requests%rowtype;
  v_tenant public.tenants%rowtype;
  v_subscription public.tenant_subscriptions%rowtype;
  v_user_email text;
  v_trial_days integer;
  v_subscription_status text;
  v_audit_id uuid;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'activation token is invalid' using errcode = '22023';
  end if;

  select *
  into v_invitation
  from public.tenant_activation_invitations
  where token_hash = decode(p_token_hash, 'hex')
  for update;

  if v_invitation.id is null then
    raise exception 'activation invitation not found' using errcode = 'P0002';
  end if;

  if v_invitation.status = 'accepted' then
    if v_invitation.accepted_user_id <> p_user_id then
      raise exception 'activation invitation has already been used'
        using errcode = '22023';
    end if;

    select *
    into v_tenant
    from public.tenants
    where id = v_invitation.tenant_id;

    return jsonb_build_object(
      'created', false,
      'tenantId', v_tenant.id,
      'slug', v_tenant.slug,
      'status', v_tenant.status
    );
  end if;

  if v_invitation.status <> 'pending' then
    raise exception 'activation invitation is not active' using errcode = '22023';
  end if;

  if v_invitation.expires_at <= now() then
    update public.tenant_activation_invitations
    set status = 'expired'
    where id = v_invitation.id;
    raise exception 'activation invitation has expired' using errcode = '22023';
  end if;

  select lower(trim(email))
  into v_user_email
  from auth.users
  where id = p_user_id
    and email_confirmed_at is not null;

  if v_user_email is null then
    raise exception 'verified user identity not found' using errcode = 'P0002';
  end if;

  if v_user_email <> lower(trim(v_invitation.email)) then
    raise exception 'signed-in email does not match the invitation'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.tenant_users
    where user_id = p_user_id
      and tenant_id <> v_invitation.tenant_id
  ) then
    raise exception 'user already belongs to another workspace'
      using errcode = '22023';
  end if;

  select *
  into v_onboarding
  from public.onboarding_requests
  where id = v_invitation.onboarding_request_id
    and tenant_id = v_invitation.tenant_id
  for update;

  if v_onboarding.id is null then
    raise exception 'linked onboarding request not found' using errcode = 'P0002';
  end if;

  if v_onboarding.status <> 'provisioning' then
    raise exception 'onboarding request is no longer awaiting activation'
      using errcode = '22023';
  end if;

  select *
  into v_tenant
  from public.tenants
  where id = v_invitation.tenant_id
  for update;

  if v_tenant.id is null then
    raise exception 'prepared tenant not found' using errcode = 'P0002';
  end if;

  if v_tenant.status <> 'provisioning' then
    raise exception 'tenant is no longer awaiting activation'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.tenant_users
    where tenant_id = v_tenant.id
      and role = 'owner'
      and user_id <> p_user_id
  ) then
    raise exception 'workspace already has another owner' using errcode = '22023';
  end if;

  select *
  into v_subscription
  from public.tenant_subscriptions
  where tenant_id = v_tenant.id
    and status in ('trialing', 'active', 'past_due', 'grace', 'suspended', 'cancelled')
  order by created_at desc
  limit 1
  for update;

  if v_subscription.id is null then
    raise exception 'prepared subscription not found' using errcode = 'P0002';
  end if;

  select trial_days
  into v_trial_days
  from public.subscription_plans
  where plan_key = v_subscription.plan_key
    and is_active = true;

  if v_trial_days is null then
    raise exception 'subscription plan is unavailable' using errcode = '22023';
  end if;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_tenant.id, p_user_id, 'owner')
  on conflict (tenant_id, user_id)
  do update set role = 'owner';

  insert into public.tenant_domains (
    tenant_id,
    kind,
    subdomain,
    is_primary,
    verified
  )
  values (
    v_tenant.id,
    'subdomain',
    v_tenant.slug,
    true,
    true
  )
  on conflict (subdomain)
  do update set
    is_primary = true,
    verified = true
  where public.tenant_domains.tenant_id = excluded.tenant_id;

  if not exists (
    select 1
    from public.tenant_domains
    where tenant_id = v_tenant.id
      and subdomain = v_tenant.slug
  ) then
    raise exception 'workspace subdomain belongs to another tenant'
      using errcode = '23505';
  end if;

  insert into public.user_profiles (
    user_id,
    display_name,
    default_tenant_id
  )
  values (
    p_user_id,
    coalesce(nullif(trim(p_display_name), ''), v_user_email),
    v_tenant.id
  )
  on conflict (user_id)
  do update set
    display_name = coalesce(
      nullif(trim(excluded.display_name), ''),
      public.user_profiles.display_name
    ),
    default_tenant_id = excluded.default_tenant_id,
    updated_at = now();

  v_subscription_status := case
    when v_trial_days > 0 then 'trialing'
    else 'active'
  end;

  update public.tenant_subscriptions
  set status = v_subscription_status,
      owner_user_id = p_user_id,
      trial_ends_at = case
        when v_trial_days > 0 then now() + make_interval(days => v_trial_days)
        else null
      end,
      current_period_start = now(),
      current_period_end = case
        when v_trial_days > 0 then now() + make_interval(days => v_trial_days)
        else now() + interval '1 month'
      end,
      cancelled_at = null,
      cancel_at_period_end = false,
      updated_at = now()
  where id = v_subscription.id;

  update public.tenants
  set status = 'active',
      updated_at = now()
  where id = v_tenant.id;

  update public.onboarding_requests
  set status = 'completed',
      details = details || jsonb_build_object(
        'provisioningStage', 'activated',
        'activatedUserId', p_user_id,
        'activatedAt', now()
      ),
      decided_at = coalesce(decided_at, now()),
      updated_at = now()
  where id = v_onboarding.id;

  update public.tenant_activation_invitations
  set status = 'accepted',
      accepted_at = now(),
      accepted_user_id = p_user_id
  where id = v_invitation.id;

  insert into public.audit_events (
    tenant_id,
    user_id,
    action,
    target,
    metadata
  )
  values (
    v_tenant.id,
    p_user_id,
    'tenant.activated',
    v_tenant.slug,
    jsonb_build_object(
      'via', 'admin_owner_activation',
      'onboardingRequestId', v_onboarding.id,
      'subscriptionId', v_subscription.id,
      'subscriptionStatus', v_subscription_status
    )
  );

  insert into public.admin_audit_events (
    actor_user_id,
    actor_email,
    actor_roles,
    action,
    entity_type,
    entity_id,
    tenant_id,
    before_state,
    after_state,
    reason,
    severity,
    correlation_id
  )
  values (
    p_user_id,
    v_user_email,
    array[]::text[],
    'onboarding.workspace_activated',
    'onboarding_request',
    v_onboarding.id::text,
    v_tenant.id,
    jsonb_build_object(
      'tenantStatus', v_tenant.status,
      'onboardingStatus', v_onboarding.status,
      'invitationStatus', v_invitation.status,
      'subscriptionStatus', v_subscription.status
    ),
    jsonb_build_object(
      'tenantStatus', 'active',
      'onboardingStatus', 'completed',
      'invitationStatus', 'accepted',
      'subscriptionStatus', v_subscription_status,
      'ownerUserId', p_user_id
    ),
    'Invited owner accepted the workspace activation.',
    'info',
    coalesce(p_correlation_id, gen_random_uuid())
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'created', true,
    'tenantId', v_tenant.id,
    'slug', v_tenant.slug,
    'status', 'active',
    'subscriptionStatus', v_subscription_status,
    'auditEventId', v_audit_id
  );
end;
$$;

revoke all on function public.activate_prepared_tenant(
  text, uuid, text, uuid
) from public;
grant execute on function public.activate_prepared_tenant(
  text, uuid, text, uuid
) to service_role;
