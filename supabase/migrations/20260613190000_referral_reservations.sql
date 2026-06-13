-- ============================================================================
-- 20260613190000_referral_reservations.sql
-- Atomically reserve a referral slot before tenant provisioning. Locking the
-- referral-code row prevents concurrent signups from both claiming the final
-- available invitation.
-- ============================================================================

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

  select count(*)::integer
    into v_used
    from public.referral_usages
   where referral_code_id = v_code.id;

  if v_code.status = 'suspended' or v_used >= v_code.allocation then
    update public.referral_codes
       set status = 'suspended',
           updated_at = now()
     where id = v_code.id;
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

  if v_used + 1 >= v_code.allocation then
    update public.referral_codes
       set status = 'suspended',
           updated_at = now()
     where id = v_code.id;
  end if;

  return query select v_usage_id, 'reserved'::text;
end;
$$;

revoke all on function public.reserve_referral(text, uuid, text) from public;
grant execute on function public.reserve_referral(text, uuid, text) to service_role;
