-- ============================================================================
-- 20260610090000_whatsapp_session_material.sql
-- ADR-036 — the WhatsApp Web-session bridge becomes real (behind a feature flag).
--
-- Durable, opaque home for each tenant's WhatsApp auth/session MATERIAL (the
-- Baileys credential + signal-key state the bridge needs to resume a session).
-- This is the crown jewel (SR-34/35): it is the security posture of
-- integration_credentials, held SEPARATELY from the whatsapp_sessions metadata
-- table exactly as ADR-036 mandates ("held like integration_credentials, never
-- in whatsapp_sessions metadata").
--
-- * Server-only: NO `authenticated` grant — the operator (and therefore the
--   browser/RLS user client) can never read it; only the service_role and the
--   bridge (via the internal, callback-token-authenticated route) touch it.
-- * Opaque: the column stores ciphertext only. Encryption is performed by the
--   bridge with a key that lives ONLY on the bridge runtime, so even a full
--   database compromise yields no usable session material.
-- * Tenant-scoped + RLS-isolated, one row per tenant, cascades on session/tenant
--   delete so "disconnect & delete" wipes the material.
-- Governance: architecture/whatsapp-session-architecture.md (ADR-036),
-- risks/security-risks.md SR-34/35, data-architecture.md.
-- ============================================================================

create table public.whatsapp_session_material (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  whatsapp_session_id uuid not null references public.whatsapp_sessions(id) on delete cascade,
  -- Opaque, bridge-encrypted blob (AES-256-GCM: iv|tag|ciphertext, base64). The
  -- app never decrypts this; the key never leaves the bridge runtime.
  ciphertext          text not null,
  -- Non-secret hint so the bridge can refuse to decrypt with a rotated key.
  key_version         int  not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id)  -- one session per tenant (mirrors whatsapp_sessions)
);
create index whatsapp_session_material_session_idx
  on public.whatsapp_session_material (whatsapp_session_id);
create trigger whatsapp_session_material_set_updated_at
  before update on public.whatsapp_session_material
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Grants — service_role ONLY. There is deliberately NO grant to `authenticated`:
-- session material must never be reachable by an operator or the browser.
-- ============================================================================
grant all on table public.whatsapp_session_material to service_role;

-- ============================================================================
-- RLS — enabled with no permissive policy for `authenticated`, so even if a
-- grant were added by mistake, every authenticated read/write is denied. The
-- service_role bypasses RLS (BYPASSRLS) and remains the only path in.
-- ============================================================================
alter table public.whatsapp_session_material enable row level security;
-- (no policies: authenticated access is fully denied by default-deny RLS)
