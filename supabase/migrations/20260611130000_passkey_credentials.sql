-- ============================================================================
-- 20260611130000_passkey_credentials.sql
-- WebAuthn passkey credentials (authentication-architecture.md §4–6, ADR-022).
-- A credential authenticates a USER (RP ID = the registrable apex, so one
-- passkey spans every <slug> subdomain); it is not tenant-scoped. The tenant
-- where enrolment happened is recorded for audit/provenance only.
--
-- Public keys are verification-only material (no shared secret): the private
-- key never leaves the operator's authenticator. Attestation is verified
-- server-side before insert, so writes go through the service role; users may
-- read, relabel, and revoke their OWN credentials directly (RLS-enforced).
-- ============================================================================

create table public.passkey_credentials (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  -- Base64url credential id as returned by the authenticator (WebAuthn rawId).
  credential_id        text not null unique,
  -- Base64url-encoded COSE public key; verification-only material.
  public_key           text not null,
  transports           text[] not null default '{}',
  -- WebAuthn credentialDeviceType: synced ("multi_device") or bound ("single_device").
  device_type          text not null default 'single_device'
                         check (device_type in ('single_device', 'multi_device')),
  backed_up            boolean not null default false,
  -- Operator-facing label ("MacBook Touch ID", "YubiKey 5") for device management.
  label                text,
  sign_count           bigint not null default 0,
  -- Provenance only: the workspace where enrolment happened (audit trail).
  registered_tenant_id uuid references public.tenants (id) on delete set null,
  created_at           timestamptz not null default now(),
  last_used_at         timestamptz
);

create index passkey_credentials_user_idx
  on public.passkey_credentials (user_id, created_at desc);

-- --- grants ------------------------------------------------------------------
grant select, update, delete on table public.passkey_credentials to authenticated;
grant all on table public.passkey_credentials to service_role;

-- --- RLS ----------------------------------------------------------------------
alter table public.passkey_credentials enable row level security;

-- Inserts only via the service role after server-side attestation verification;
-- a client can never write credential material directly.
create policy passkey_credentials_self_select on public.passkey_credentials
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Relabel own credentials (device management).
create policy passkey_credentials_self_update on public.passkey_credentials
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Revoke own credentials.
create policy passkey_credentials_self_delete on public.passkey_credentials
  for delete to authenticated
  using (user_id = (select auth.uid()));
