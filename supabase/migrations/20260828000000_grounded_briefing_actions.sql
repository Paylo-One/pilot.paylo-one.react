-- Atomically create an operator-confirmed action and preserve the selected
-- Daily Memo section's existing evidence. No client-supplied reference content
-- is trusted.
create or replace function public.create_action_from_briefing_section(
  p_tenant_id uuid, p_section_id uuid, p_action jsonb
)
returns public.suggested_actions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.suggested_actions;
begin
  if auth.uid() is null
    or not (p_tenant_id in (select public.auth_tenant_ids())) then
    raise exception 'not authorised for workspace' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.briefing_sections section
    where section.id = p_section_id and section.tenant_id = p_tenant_id
  ) then
    raise exception 'briefing section not found in workspace' using errcode = 'P0002';
  end if;

  if nullif(p_action ->> 'person_id', '') is not null
    and not exists (
      select 1 from public.people person
      where person.id = (p_action ->> 'person_id')::uuid
        and person.tenant_id = p_tenant_id
    ) then
    raise exception 'person not found in workspace' using errcode = 'P0002';
  end if;

  insert into public.suggested_actions (
    tenant_id, title, description, status, priority, due_at, follow_up_at,
    topics, person_id, rationale, created_by, created_from
  ) values (
    p_tenant_id, p_action ->> 'title', nullif(p_action ->> 'description', ''),
    coalesce(nullif(p_action ->> 'status', ''), 'inbox'),
    coalesce(nullif(p_action ->> 'priority', ''), 'normal'),
    nullif(p_action ->> 'due_at', '')::timestamptz,
    nullif(p_action ->> 'follow_up_at', '')::timestamptz,
    coalesce(array(select jsonb_array_elements_text(p_action -> 'topics')), '{}'::text[]),
    nullif(p_action ->> 'person_id', '')::uuid,
    nullif(p_action ->> 'rationale', ''), auth.uid(), 'briefing'
  ) returning * into v_action;

  insert into public.source_references (
    tenant_id, suggested_action_id, source_item_id, source_system,
    item_timestamp, confidence, excerpt_or_pointer, diary_entry_id, person_id
  )
  select p_tenant_id, v_action.id, reference.source_item_id,
    reference.source_system, reference.item_timestamp, reference.confidence,
    reference.excerpt_or_pointer, reference.diary_entry_id, reference.person_id
  from public.source_references reference
  where reference.briefing_section_id = p_section_id
    and reference.tenant_id = p_tenant_id;

  return v_action;
end;
$$;

revoke all on function public.create_action_from_briefing_section(uuid, uuid, jsonb) from public;
grant execute on function public.create_action_from_briefing_section(uuid, uuid, jsonb) to authenticated;
