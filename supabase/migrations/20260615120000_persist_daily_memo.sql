-- ============================================================================
-- 20260615120000_persist_daily_memo.sql
-- Persist a Daily Memo (briefing + ordered sections + suggested actions + their
-- source references) in a single transaction. Previously the orchestration layer
-- issued these inserts one statement at a time over the Supabase client, so a
-- failure partway through (e.g. a rejected check constraint) could leave a
-- briefing row with fewer sections/actions than intended. A plpgsql function
-- runs in its own implicit transaction, so any error rolls the whole memo back.
--
-- Reference-resolution (token -> real item, fallback) and excerpts stay in the
-- application layer; this function only performs the atomic write. Payloads:
--   p_sections: [{ kind, position, title, body,
--                  references: [{ source_item_id, source_system, item_timestamp,
--                                 confidence, excerpt_or_pointer }] }]
--   p_actions:  [{ status, created_from, title, rationale, references: [...] }]
-- ============================================================================

create or replace function public.persist_daily_memo(
  p_tenant_id uuid,
  p_summary text,
  p_prompt_version_id uuid,
  p_sections jsonb,
  p_actions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_briefing_id uuid;
  v_section jsonb;
  v_action jsonb;
  v_ref jsonb;
  v_section_id uuid;
  v_action_id uuid;
begin
  insert into public.briefings (tenant_id, status, summary, prompt_version_id)
  values (p_tenant_id, 'ready', p_summary, p_prompt_version_id)
  returning id into v_briefing_id;

  for v_section in
    select value from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb))
  loop
    insert into public.briefing_sections (tenant_id, briefing_id, kind, position, title, body)
    values (
      p_tenant_id,
      v_briefing_id,
      v_section ->> 'kind',
      coalesce((v_section ->> 'position')::int, 0),
      v_section ->> 'title',
      v_section ->> 'body'
    )
    returning id into v_section_id;

    for v_ref in
      select value from jsonb_array_elements(coalesce(v_section -> 'references', '[]'::jsonb))
    loop
      insert into public.source_references (
        tenant_id, briefing_section_id, source_item_id, source_system,
        item_timestamp, confidence, excerpt_or_pointer
      )
      values (
        p_tenant_id,
        v_section_id,
        nullif(v_ref ->> 'source_item_id', '')::uuid,
        v_ref ->> 'source_system',
        nullif(v_ref ->> 'item_timestamp', '')::timestamptz,
        nullif(v_ref ->> 'confidence', '')::numeric,
        v_ref ->> 'excerpt_or_pointer'
      );
    end loop;
  end loop;

  for v_action in
    select value from jsonb_array_elements(coalesce(p_actions, '[]'::jsonb))
  loop
    insert into public.suggested_actions (tenant_id, briefing_id, status, created_from, title, rationale)
    values (
      p_tenant_id,
      v_briefing_id,
      coalesce(v_action ->> 'status', 'inbox'),
      coalesce(v_action ->> 'created_from', 'briefing'),
      v_action ->> 'title',
      v_action ->> 'rationale'
    )
    returning id into v_action_id;

    for v_ref in
      select value from jsonb_array_elements(coalesce(v_action -> 'references', '[]'::jsonb))
    loop
      insert into public.source_references (
        tenant_id, suggested_action_id, source_item_id, source_system,
        item_timestamp, confidence, excerpt_or_pointer
      )
      values (
        p_tenant_id,
        v_action_id,
        nullif(v_ref ->> 'source_item_id', '')::uuid,
        v_ref ->> 'source_system',
        nullif(v_ref ->> 'item_timestamp', '')::timestamptz,
        nullif(v_ref ->> 'confidence', '')::numeric,
        v_ref ->> 'excerpt_or_pointer'
      );
    end loop;
  end loop;

  return v_briefing_id;
end;
$$;

grant execute on function public.persist_daily_memo(uuid, text, uuid, jsonb, jsonb) to service_role;
