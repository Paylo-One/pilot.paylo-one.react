-- ============================================================================
-- 20260610120000_legal_acceptances.sql
-- Legal acceptance evidence: which user accepted which version of which legal
-- document (Terms and Conditions, Privacy Policy), when, and from where. The
-- table is user-scoped (acceptance happens at account creation, before any
-- tenant exists) and append-only: rows are immutable evidence, never updated.
-- Re-acceptance after a document version bump simply appends a new row; the
-- app compares the latest accepted version per document against the current
-- versions shipped in lib/legal/*.
--
-- Writes happen server-side with the service role (the onboarding server
-- action); authenticated users may only read their own history.
-- ============================================================================

create table public.legal_acceptances (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  document    text not null check (document in ('terms', 'privacy')),
  version     text not null,
  accepted_at timestamptz not null default now(),
  ip_address  inet,
  user_agent  text
);

create index legal_acceptances_user_doc_idx
  on public.legal_acceptances (user_id, document, accepted_at desc);

-- --- grants ------------------------------------------------------------------
grant select on table public.legal_acceptances to authenticated;
grant all on table public.legal_acceptances to service_role;

-- --- RLS ----------------------------------------------------------------------
alter table public.legal_acceptances enable row level security;

-- Users may read their own acceptance history; all writes go through the
-- service role (BYPASSRLS) so acceptances cannot be forged or altered from the
-- client.
create policy legal_acceptances_self_select on public.legal_acceptances
  for select to authenticated
  using (user_id = (select auth.uid()));
