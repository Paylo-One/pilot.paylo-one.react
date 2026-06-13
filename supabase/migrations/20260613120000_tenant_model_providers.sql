-- ============================================================================
-- 20260613120000_tenant_model_providers.sql
-- Bring-your-own-key model providers (ADR-038). A tenant may register its own
-- Anthropic or OpenAI API key + model and route the workspace's AI processing
-- through it instead of the Paylo-hosted default. The active, verified provider
-- becomes a tenant-owned catalogue model the Model Gateway routes completions to
-- (ADR-013/014: still only ever reached via the Gateway + adapter; the key never
-- leaves the server and is never client-exposed).
--
-- Security posture mirrors `integration_credentials` exactly: this table holds a
-- SECRET (`api_key`) and is therefore SERVER-ONLY — RLS is enabled with NO
-- authenticated policy, and there is NO grant to authenticated/anon. Every read
-- and write goes through the service role with an explicit tenant_id; the UI
-- reads a MASKED projection (provider/model/status/key_hint) via a server module,
-- never the key itself. Encryption-at-rest (Vault/envelope) is the documented
-- hardening follow-up, same as integration_credentials.
--
-- Governance: ADR-038, architecture/model-inference-architecture.md,
-- services/model-catalogue-service.md, architecture/security-and-privacy.md.
-- ============================================================================

create table public.tenant_model_providers (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  -- Which frontier provider the key authenticates against.
  provider         text not null check (provider in ('openai','anthropic')),
  -- The exact provider model id used at call time (e.g. gpt-4o, claude-3-5-sonnet-20241022).
  model_id         text not null,
  -- Operator-facing label; defaults to the model id when not given.
  display_name     text not null,
  -- SECRET — server-only; never selected into any authenticated/RLS path.
  api_key          text not null,
  -- Non-secret display hint, e.g. "sk-…a1b2" (last 4), shown in the UI.
  key_hint         text not null,
  -- Verification lifecycle: a key is not routable until a real test call succeeds.
  status           text not null default 'untested'
                     check (status in ('untested','verified','failed')),
  last_error       text,
  last_verified_at timestamptz,
  -- At most one active provider per tenant is the routing choice (partial unique below).
  is_active        boolean not null default false,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index tenant_model_providers_tenant_idx
  on public.tenant_model_providers (tenant_id);
-- At most one active provider per tenant.
create unique index tenant_model_providers_one_active
  on public.tenant_model_providers (tenant_id) where is_active;
create trigger tenant_model_providers_set_updated_at
  before update on public.tenant_model_providers
  for each row execute function public.set_updated_at();

-- Server/worker full access; service_role bypasses RLS but still needs privileges.
grant all on table public.tenant_model_providers to service_role;
-- Intentionally NO grant to authenticated/anon: this table holds API keys.

-- RLS enabled with NO authenticated policy → end users are denied entirely;
-- only the service role (BYPASSRLS) can touch it. Mirrors integration_credentials.
alter table public.tenant_model_providers enable row level security;
