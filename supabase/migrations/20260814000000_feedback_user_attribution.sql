-- Feedback is user-attributed audit data. Tenant membership alone must not let
-- a browser forge another user's authorship through the direct PostgREST API.
drop policy if exists ufe_insert on public.user_feedback_events;
create policy ufe_insert on public.user_feedback_events
  for insert to authenticated
  with check (
    tenant_id in (select public.auth_tenant_ids())
    and user_id = (select auth.uid())
  );
