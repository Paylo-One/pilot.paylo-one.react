-- Atomically create an operator-confirmed action and preserve the selected
-- Daily Memo section's existing evidence. No client-supplied reference content
-- is trusted.
alter table public.suggested_actions
  add column briefing_section_id uuid references public.briefing_sections(id) on delete set null,
  add column briefing_handoff_key uuid;

create unique index suggested_actions_briefing_handoff_key_idx
  on public.suggested_actions (tenant_id, created_by, briefing_handoff_key)
  where briefing_handoff_key is not null;

create or replace function public.create_action_from_briefing_section(
  p_tenant_id uuid, p_section_id uuid, p_handoff_key uuid, p_action jsonb
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

  if p_handoff_key is null
    or coalesce(jsonb_typeof(p_action), 'null') <> 'object'
    or pg_column_size(p_action) > 32768
    or length(coalesce(p_action ->> 'title', '')) not between 1 and 200
    or length(coalesce(p_action ->> 'description', '')) > 1000
    or length(coalesce(p_action ->> 'rationale', '')) > 2000 then
    raise exception 'invalid action payload' using errcode = '22023';
  end if;

  if p_action ? 'topics' and jsonb_typeof(p_action -> 'topics') <> 'array' then
    raise exception 'invalid action payload' using errcode = '22023';
  end if;

  if jsonb_array_length(coalesce(p_action -> 'topics', '[]'::jsonb)) > 20
    or exists (
      select 1 from jsonb_array_elements_text(coalesce(p_action -> 'topics', '[]'::jsonb)) topic
      where length(topic) > 100
    ) then
    raise exception 'invalid action payload' using errcode = '22023';
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
    topics, person_id, rationale, created_by, created_from,
    briefing_section_id, briefing_handoff_key
  ) values (
    p_tenant_id, p_action ->> 'title', nullif(p_action ->> 'description', ''),
    coalesce(nullif(p_action ->> 'status', ''), 'inbox'),
    coalesce(nullif(p_action ->> 'priority', ''), 'normal'),
    nullif(p_action ->> 'due_at', '')::timestamptz,
    nullif(p_action ->> 'follow_up_at', '')::timestamptz,
    coalesce(array(select jsonb_array_elements_text(p_action -> 'topics')), '{}'::text[]),
    nullif(p_action ->> 'person_id', '')::uuid,
    nullif(p_action ->> 'rationale', ''), auth.uid(), 'briefing',
    p_section_id, p_handoff_key
  ) on conflict (tenant_id, created_by, briefing_handoff_key)
    where briefing_handoff_key is not null
    do nothing
  returning * into v_action;

  if v_action.id is null then
    select action.* into v_action
    from public.suggested_actions action
    where action.tenant_id = p_tenant_id
      and action.created_by = auth.uid()
      and action.briefing_handoff_key = p_handoff_key;

    if v_action.id is null or v_action.briefing_section_id <> p_section_id then
      raise exception 'handoff key conflict' using errcode = '23505';
    end if;
    return v_action;
  end if;

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

revoke all on function public.create_action_from_briefing_section(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.create_action_from_briefing_section(uuid, uuid, uuid, jsonb) to authenticated;
