# Paylo.one Management OS — Application

The application for **Paylo.one Management OS**, a private management operating
system for high-context leaders. It runs **operationally against a local
Supabase stack**: real magic-link auth (passkey-ready), multi-tenant workspaces
with subdomain routing and Postgres RLS isolation, source ingestion (file/paste
upload + a GitHub OAuth connector), a real **Daily Memo** generated via OpenAI
through the governed Model Gateway, an Actions queue, and a private Diary.

Passkey **registration + device management are real** (WebAuthn via
SimpleWebAuthn, `passkey_credentials` table, Settings → Security); passkey
**login/assertion is not yet** — sign-in stays on the magic link. Still
intentionally out for this pass: **passkey login, payments, vLLM/GPU,
Cloudflare/DNS, and production deploy.** A few non-focus paths remain typed
stubs that throw `NotImplementedError` (greppable).

Architecture and decisions are governed by `../governance/` — start with
`governance/docs/architecture/technical-design.md`. This app is the
implementation of that design; the governance docs remain the source of truth.

## Stack

- **Next.js (App Router) + TypeScript + React** (versions pinned to the
  marketing site).
- **Supabase** (Postgres + Auth + Storage), wired locally via `@supabase/ssr`
  (publishable/secret keys, RLS on every tenant table). **OpenAI** via the Model
  Gateway. Inngest / Vercel / Cloudflare remain target platform (not wired).
- **Modular monolith**: one deployable app; code organised into `modules/*`
  with explicit boundaries that mirror the service catalogue.

## Structure

```
app/
  (marketing)/            # apex (paylo.one) invite/landing for the app
  (auth)/                 # sign-in / invite acceptance (passkey-ready)
  (app)/                  # tenant app, served on <slug>.paylo.one
    briefing/ actions/ diary/ sources/ settings/
  api/
    health/               # operational probe
    inngest/              # single workflow endpoint (stub)
    webhooks/[source]/    # inbound webhooks (stub)
    model-gateway/        # internal model-access API
    tool-gateway/         # internal MCP tool-access API
  globals.css layout.tsx
lib/
  config.ts               # env-backed config (secrets only in env)
  supabase/               # browser / server / secret-key client factories (stubs)
  tenant/                 # host parsing + shared reserved-subdomain blocklist
modules/                  # the modular monolith — one folder per service
  shared/                 # TenantContext, Result, errors, domain primitives
  identity-tenant/        # tenant model, membership, provisioning, subdomains
  authentication/         # passkey-ready auth (auth area of Identity & Tenant)
  tool-gateway/           # MCP tool access: policy, risk, approval, audit
  mcp-registry/           # MCP servers + tools registry (capability + risk class)
  model-gateway/          # provider abstraction, routing, policy, validation
  model-catalogue/ model-entitlement/ model-usage-cost/ prompt-versioning/
  briefing/ action-extraction/ diary/ source-connection/ ingestion/
  normalisation/ knowledge-store/ search-retrieval/ agent-orchestration/
  notification/ audit/ billing/
proxy.ts                  # host-based tenant resolution + auth gate (edge)
supabase/migrations/      # SQL placeholders (schema + RLS), not executed
```

**Module boundary rule:** modules expose a typed service interface and never
reach into another module's internals. Cross-module calls go through the
interface. `modules/shared` holds the tenant-context object and common types.

## The four governed pillars

- **Multi-tenancy** (`modules/identity-tenant`, `lib/tenant`, `proxy.ts`):
  tenant-per-workspace, subdomain routing with a shared reserved-subdomain
  blocklist, server-side tenant re-derivation, and RLS as the database backstop.
- **Passkey-ready auth** (`modules/authentication`, `(auth)/`): real WebAuthn
  registration + credential management (`modules/authentication/server.ts`,
  Settings → Security; RP ID = the registrable apex). Login/assertion, recovery
  and session↔tenant-binding remain documented contracts.
- **MCP / Tool Gateway** (`modules/tool-gateway`, `modules/mcp-registry`,
  `api/tool-gateway`): the single front door for tool calls — policy, risk
  classification, human approval, routing, output sanitisation, audit. MCP
  servers are the runtimes behind it; nothing executes in the scaffold.
- **Model Gateway** (`modules/model-gateway` + siblings, `api/model-gateway`):
  the single front door for inference — policy, prompt assembly, routing,
  output validation, usage + audit. Providers/vLLM sit behind adapters that
  throw `NotImplementedError`.

## Run locally

```bash
cd app
npm install
npx supabase start          # local Postgres/Auth/Storage at :54321 (Mailpit :54324)
npx supabase db reset       # apply migrations (tenancy + product schema + RLS)
cp .env.example .env.local   # then set OPENAI_API_KEY (+ optional GitHub OAuth)
npm run dev                  # http://lvh.me:3000
```

First run: open `http://lvh.me:3000/sign-in`, request a magic link, open it from
Mailpit (`http://127.0.0.1:54324`), choose a subdomain at `/onboarding`, and you
land in your workspace at `http://<slug>.lvh.me:3000`. `*.lvh.me` resolves to
127.0.0.1, so subdomains work without DNS; the auth cookie is apex-scoped
(`.lvh.me`) so the session spans subdomains.

GitHub connector (optional): create a GitHub OAuth app with callback
`http://app.lvh.me:3000/api/oauth/github/callback` and set
`GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` in `.env.local`. File /
paste upload works without it.

Checks:

```bash
npm run typecheck   # tsc --noEmit
npm run lint
npm run build
```

## What is intentionally NOT here

Real passkeys/WebAuthn (auth is magic-link, passkey-ready), payment processing,
vLLM/GPU inference, durable Inngest jobs, and Cloudflare/DNS + production
deploy. The non-OpenAI Model Gateway adapters and the Tool Gateway / MCP
execution paths remain typed stubs. These are documented in `../governance/`.
