-- --- Scheduled Source Syncing Schema Extension (ADR-043) --------------------
--
-- Per-source automatic refresh + per-tenant sync cycles that, on completion,
-- trigger one Daily Memo. The cron dispatcher (Inngest scheduled function)
-- claims due connections atomically via start_scheduled_sync_runs(); each
-- per-source job reports completion via complete_source_in_run(), which
-- finalises the run and signals when the last source is done.
--
-- Governance: docs/decisions/architecture-decisions.md (ADR-043),
-- docs/architecture/source-integration-strategy.md (§ Scheduled syncing).

-- 1. Add scheduling-related columns to public.source_connections
alter table public.source_connections
  add column auto_refresh_enabled boolean not null default false,
  add column sync_frequency text not null default 'daily'
    check (sync_frequency in ('daily', 'twice_a_day', 'three_times_a_day', 'four_times_a_day')),
  add column next_sync_at timestamptz,
  add column last_sync_status text
    check (last_sync_status in ('success', 'failed', 'syncing')),
  add column last_sync_error text,
  -- Timestamp a connection was claimed into a run (for stale-claim recovery:
  -- a claim older than the reaper threshold is eligible to be re-dispatched).
  add column sync_claimed_at timestamptz;

-- Index for scheduler high-precision polling
create index source_connections_auto_refresh_next_sync_idx
  on public.source_connections (auto_refresh_enabled, next_sync_at)
  where auto_refresh_enabled = true;

-- 2. Create public.scheduled_sync_runs tracking table
create table public.scheduled_sync_runs (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  status             text not null default 'running'
                     check (status in ('running', 'completed', 'failed', 'partial')),
  sources_to_sync    jsonb not null default '[]'::jsonb, -- Array of connection UUIDs
  sources_completed  jsonb not null default '[]'::jsonb, -- Array of connection UUIDs
  sources_failed     jsonb not null default '[]'::jsonb, -- Array of connection UUIDs
  -- The Daily Memo produced when this cycle finished (idempotency + provenance);
  -- null until the briefing job runs.
  briefing_id        uuid references public.briefings(id) on delete set null,
  started_at         timestamptz not null default now(),
  completed_at       timestamptz,
  created_at         timestamptz not null default now()
);

-- Index for tenant-scoped runs lookup
create index scheduled_sync_runs_tenant_idx on public.scheduled_sync_runs (tenant_id);
create index scheduled_sync_runs_status_idx on public.scheduled_sync_runs (status);

-- 3. Row Level Security (RLS) for scheduled_sync_runs
alter table public.scheduled_sync_runs enable row level security;

-- Users can view sync runs for their own tenants
create policy sync_runs_select on public.scheduled_sync_runs
  for select
  using (tenant_id in (select public.auth_tenant_ids()));

-- 4. Grants
grant select on table public.scheduled_sync_runs to authenticated;
grant all on table public.scheduled_sync_runs to service_role;

-- 5. RPC: atomically claim all due connections and open one run per tenant.
--    Runs as the service role (cron dispatcher). Returns one row per claimed
--    connection so the caller can fan out a source/sync job per connection.
--    Claiming = marking the connection 'syncing' + stamping sync_claimed_at, so
--    a subsequent tick won't re-pick an in-flight connection (no duplicate
--    syncs). A claim older than 1 hour is treated as stale and re-claimable.
create or replace function public.start_scheduled_sync_runs()
  returns table(run_id uuid, tenant_id uuid, connection_id uuid)
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  t record;
  new_run_id uuid;
begin
  for t in
    select sc.tenant_id as tid, array_agg(sc.id) as ids
    from public.source_connections sc
    where sc.auto_refresh_enabled = true
      and sc.status = 'connected'
      and sc.next_sync_at is not null
      and sc.next_sync_at <= now()
      and (
        sc.last_sync_status is distinct from 'syncing'
        or sc.sync_claimed_at is null
        or sc.sync_claimed_at < now() - interval '1 hour'
      )
    group by sc.tenant_id
  loop
    insert into public.scheduled_sync_runs (tenant_id, status, sources_to_sync)
    values (t.tid, 'running', to_jsonb(t.ids))
    returning id into new_run_id;

    update public.source_connections
      set last_sync_status = 'syncing',
          sync_claimed_at = now(),
          last_sync_error = null
    where id = any(t.ids);

    run_id := new_run_id;
    tenant_id := t.tid;
    foreach connection_id in array t.ids
    loop
      return next;
    end loop;
  end loop;
end;
$$;

revoke all on function public.start_scheduled_sync_runs() from public, authenticated;
grant execute on function public.start_scheduled_sync_runs() to service_role;

-- 6. RPC: atomically record one source's completion within a run and finalise
--    the run when the last source is done. Returns true when the run just
--    finished (the caller should then trigger briefing/generate exactly once).
--    Row-level lock (for update) serialises concurrent per-source completions.
create or replace function public.complete_source_in_run(
  p_run_id uuid,
  p_connection_id uuid,
  p_success boolean
)
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  r record;
  v_to_sync jsonb;
  v_completed jsonb;
  v_failed jsonb;
  v_finished boolean;
  v_status text;
begin
  select * into r from public.scheduled_sync_runs where id = p_run_id for update;
  if not found then
    raise exception 'scheduled_sync_run % not found', p_run_id;
  end if;

  -- Drop this connection from the outstanding set.
  v_to_sync := (
    select coalesce(jsonb_agg(elem), '[]'::jsonb)
    from jsonb_array_elements_text(r.sources_to_sync) elem
    where elem <> p_connection_id::text
  );

  if p_success then
    v_completed := (
      select coalesce(jsonb_agg(distinct e), '[]'::jsonb)
      from jsonb_array_elements_text(r.sources_completed || to_jsonb(p_connection_id::text)) e
    );
    v_failed := r.sources_failed;
  else
    v_completed := r.sources_completed;
    v_failed := (
      select coalesce(jsonb_agg(distinct e), '[]'::jsonb)
      from jsonb_array_elements_text(r.sources_failed || to_jsonb(p_connection_id::text)) e
    );
  end if;

  v_finished := jsonb_array_length(v_to_sync) = 0;
  if v_finished then
    v_status := case when jsonb_array_length(v_failed) > 0 then 'partial' else 'completed' end;
  else
    v_status := 'running';
  end if;

  update public.scheduled_sync_runs
    set sources_to_sync = v_to_sync,
        sources_completed = v_completed,
        sources_failed = v_failed,
        status = v_status,
        completed_at = case when v_finished then now() else null end
  where id = p_run_id;

  return v_finished;
end;
$$;

revoke all on function public.complete_source_in_run(uuid, uuid, boolean) from public, authenticated;
grant execute on function public.complete_source_in_run(uuid, uuid, boolean) to service_role;
