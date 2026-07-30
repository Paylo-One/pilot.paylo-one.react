# Pilot by Paylo.one — Application

The application for **Pilot by Paylo.one**, a calm intelligence layer for
leaders. It runs **operationally against a local
Supabase stack**: real magic-link auth (passkey-ready), multi-tenant workspaces
with subdomain routing and Postgres RLS isolation, source ingestion (file/paste
upload + direct connectors), optional tenant-scoped **News Briefing** via RSS
and GDELT, a real **Daily Memo** generated via OpenAI
through the governed Model Gateway, an Actions queue, and a private Diary.

Passkey auth is **real end-to-end** via native Supabase WebAuthn
(`auth.registerPasskey` / `signInWithPasskey` / `auth.passkey.*`): registration
+ device management in Settings → Security, passkey-first sign-in with the
magic link as fallback. Supabase owns the credentials and mints the session;
RP ID = the registrable apex, so one passkey spans every subdomain. Still
intentionally out for this pass: **recovery codes, payments, vLLM/GPU,
Cloudflare/DNS, and production deploy.** A few non-focus paths remain typed
stubs that throw `NotImplementedError` (greppable).

Architecture and decisions are governed by `../governance/` — start with
`governance/docs/architecture/technical-design.md`. This app is the
implementation of that design; the governance docs remain the source of truth.

## Tech Stack

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
  briefing/ action-extraction/ diary/ source-connection/ ingestion/ news/
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
- **Passkey auth** (`(auth)/sign-in`, `(app)/settings`): native Supabase
  WebAuthn — registration, credential management, and passkey-first login
  (`auth.registerPasskey` / `signInWithPasskey` / `auth.passkey.*`; Settings →
  Security, sign-in; RP ID = the registrable apex; Supabase owns credentials +
  session). Recovery codes and the email-recovery flow remain documented
  contracts in `modules/authentication`.
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

News Briefing is optional and off by default. Open **Sources → News**, choose
categories/keywords/monitored entities, enable RSS and/or GDELT, then use
**Fetch now**. Inngest dispatches durable per-tenant ingestion jobs every four
hours; the internal `POST /api/news/ingest` endpoint can enqueue the same jobs
with `Authorization: Bearer $NEWS_INGESTION_TOKEN`. Full implementation and API
contracts are in [`docs/news-briefing.md`](docs/news-briefing.md).

### Daily briefing email + notifications (SendGrid)

The Actions board is backed by in-app notifications (bell in the topbar) and a
daily briefing email. Every 15 minutes Inngest (`daily-briefing-email-dispatch`)
checks which tenant owners have passed their local briefing time
(`user_profiles.timezone` + `briefing_time`) and sends at most one email per
user per local calendar day. Idempotency is enforced twice: the Inngest event
key and a unique claim row in `notification_deliveries`. Empty days send
nothing. Users can opt out in **Settings → Profile** or via the unsubscribe
link in every email (`/api/notifications/unsubscribe`, RFC 8058 one-click).

Configuration (see `.env.example`): `SENDGRID_API_KEY` (required for delivery;
without it the job logs the skip and sends nothing) and `SENDGRID_FROM_EMAIL`
(optional, defaults to `pilot@paylo.one`; must be a verified SendGrid sender).

### Paddle fulfilment (webhooks + customer portal)

Paddle fulfils the public self-service tiers (Starter/Pro/Advanced) sold on the
marketing site. The app receives Paddle webhooks at
`POST /api/webhooks/paddle`, mirrors state into `paddle_customers` /
`tenant_subscriptions` (with `paddle_subscriptions_unlinked` staging anonymous
checkouts until the buyer registers), and mints customer-portal sessions at
`POST /api/billing/paddle-portal`.

One-time operator setup (manual — do this in the Paddle dashboard matching
`PADDLE_ENV`, sandbox first):

1. **Developer tools → Authentication**: create/copy an API key into
   `PADDLE_API_KEY`.
2. **Developer tools → Notifications**: create a notification destination of
   type *webhook* pointing at `https://<app-domain>/api/webhooks/paddle`,
   subscribed to exactly these six event types: `subscription.created`,
   `subscription.updated`, `subscription.canceled`, `customer.created`,
   `customer.updated`, `transaction.completed`.
3. Copy that destination's **signing secret** into `PADDLE_WEBHOOK_SECRET`.
   This is a *different* credential from the API key — the API key
   authenticates outbound calls, the signing secret verifies inbound webhooks.
4. Set `PADDLE_ENV` (`sandbox` or `production`) and the six
   `PADDLE_PRICE_*` ids (same variable names as the marketing repo).
5. In production, the webhook route fetches Paddle's current live `/32` CIDRs
   from `https://api.paddle.com/ips`, caches them for one hour, and rejects any
   other Vercel-forwarded source IP. Do not replace this with a hard-coded list;
   configure the Vercel WAF to bypass bot checks for the same webhook path.

Until the secret is configured the endpoint answers 500, so Paddle keeps
retrying and no events are lost; invalid signatures answer 400 and write
nothing. Every verified event is ledgered in `billing_events` (idempotent on
the Paddle event id) before any state change.

> **Do not delete live fulfilment state.** Never delete (or suggest deleting)
> the notification destination or its signing secret, the products/prices
> behind the pricing page, or any customers/subscriptions/transactions in
> Paddle or in the database (`paddle_customers`,
> `paddle_subscriptions_unlinked` rows are stamped `promoted_at`, never
> removed). The only deletable thing is a throwaway artifact you yourself
> created purely for a test — name it and confirm first.

Access posture (ADR-053): `tenants.status` is the sole access authority.
Paddle payment states are operational signals only — webhook handlers never
mutate `tenants.status`, `past_due` keeps access (banner-only), and a
scheduled cancel/pause never revokes anything until Paddle applies it.

Checks:

```bash
npm run typecheck   # tsc --noEmit
npm run lint
npm run build
```

## Continuous integration

CI runs on every push/PR (`.github/workflows/ci.yml`), in two jobs:

- **quality** — `npm ci`, lint, typecheck, unit tests (Node 22). The runtime
  tenant-isolation suite self-skips here (no DB env), so this stays fast.
- **tenant-isolation** — boots the Supabase local stack (real Postgres + Auth +
  PostgREST with all migrations applied) and runs the runtime RLS test, proving
  a member of one tenant cannot read another tenant's rows.

Run the whole pipeline locally before pushing (needs Docker + the Supabase CLI,
`brew install supabase/tap/supabase`):

```bash
npm run ci:local              # lint + typecheck + unit + DB-backed isolation test
KEEP_SUPABASE=1 npm run ci:local   # leave the stack up for faster re-runs
```

`npm run test:integration` runs only the runtime isolation test and expects a
running stack (`supabase start`); it reads `SUPABASE_TEST_URL` /
`SUPABASE_TEST_ANON_KEY` / `SUPABASE_TEST_SERVICE_KEY`. `scripts/ci-local.sh`
wires those up from `supabase status` automatically.

## What is intentionally NOT here

Real passkeys/WebAuthn (auth is magic-link, passkey-ready), payment processing,
vLLM/GPU inference, durable Inngest jobs, and Cloudflare/DNS + production
deploy. The non-OpenAI Model Gateway adapters and the Tool Gateway / MCP
execution paths remain typed stubs. These are documented in `../governance/`.
