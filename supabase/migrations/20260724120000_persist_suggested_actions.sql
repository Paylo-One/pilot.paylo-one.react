-- ============================================================================
-- 20260724120000_persist_suggested_actions.sql
-- Persist AI-extracted suggested actions together with their source references
-- in a single transaction. The action-extraction agent previously inserted
-- rows into `suggested_actions` over the Supabase client with NO attribution,
-- leaving AI-suggested actions in the operator's inbox with zero citations —
-- the same unattributed-claim failure (product risk PR-1) the Daily Memo and
-- decision/risk paths were already hardened against (governance decision log
-- 2026-07-20, "memo source-attribution honesty"; follow-up: audit sibling
-- extraction agents). Attribution for actions lives in `source_references`
-- (keyed by suggested_action_id), so a correct write must insert the action
-- AND its references; a plpgsql function runs in its own implicit transaction
-- so a failure partway through rolls the whole action back rather than leaving
-- a suggestion without the references that justify it.
--
-- Reference resolution (token -> real item) and the drop of any unattributed
-- action stay in the application layer (buildAttributedSuggestedActions); this
-- function only performs the atomic write. Payload:
--   p_actions: [{ status, created_from, title, rationale, due_at,
--                 references: [{ source_item_id, source_system, item_timestamp,
--                                confidence, excerpt_or_pointer }] }]
-- Returns the number of actions inserted.
-- ============================================================================

create or replace function public.persist_suggested_actions(
  p_tenant_id uuid,
  p_actions jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action jsonb;
  v_ref jsonb;
  v_action_id uuid;
  v_count integer := 0;
begin
  for v_action in
    select value from jsonb_array_elements(coalesce(p_actions, '[]'::jsonb))
  loop
    insert into public.suggested_actions (
      tenant_id, status, created_from, title, rationale, due_at
    )
    values (
      p_tenant_id,
      coalesce(v_action ->> 'status', 'inbox'),
      coalesce(v_action ->> 'created_from', 'suggestion'),
      v_action ->> 'title',
      v_action ->> 'rationale',
      nullif(v_action ->> 'due_at', '')::timestamptz
    )
    returning id into v_action_id;
    v_count := v_count + 1;

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

  return v_count;
end;
$$;

grant execute on function public.persist_suggested_actions(uuid, jsonb) to service_role;
