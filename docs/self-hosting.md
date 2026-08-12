# Self-Hosting Pilot

This guide takes you from a clean machine to a production Pilot instance you operate yourself. If anything here is wrong or unclear, that's a bug — [open an issue](../../issues/new/choose).

**Contents:** prerequisites · architecture · database · app deployment · configuration reference · authentication · model providers · integrations · backups · upgrades · security hardening

---

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| **Node 22+** | for source-based deployment; not needed for Docker |
| **Docker + Compose** | recommended production path |
| **A Supabase stack** | Pilot's database, auth, and storage layer — Supabase Cloud (free tier is enough to start) or [self-hosted Supabase](https://supabase.com/docs/guides/self-hosting) |
| **A domain with wildcard DNS** | `*.example.com` → your server, for tenant subdomains. Single-machine testing can skip this with `lvh.me` |
| **A model provider key** | OpenAI or an OpenAI-compatible endpoint; Anthropic completions are also implemented |
| **Supabase CLI** | for schema provisioning (`brew install supabase/tap/supabase` or see supabase.com) |

**Realistic footprint:** Pilot is a standard Next.js server — 1 vCPU / 1 GB RAM runs it comfortably for personal use. The database load is modest; Supabase's free tier or a small Postgres handles it.

## 2. Architecture you are deploying

```
┌─────────────┐     ┌────────────────────────┐     ┌──────────────────┐
│   Browser    │ ──▶ │  Pilot (Next.js server) │ ──▶ │  Supabase stack   │
│ <slug>.apex  │     │  this repo, port 3000   │     │  Postgres + Auth  │
└─────────────┘     └────────────────────────┘     │  + PostgREST      │
                              │                     └──────────────────┘
                              ▼
                     Model provider(s) — your keys
                     (OpenAI-compatible endpoint)
```

Tenant workspaces live on subdomains (`<slug>.yourdomain.com`); the app resolves tenants from the Host header (`proxy.ts`). There is no separate API server, worker fleet, or queue infrastructure required for the core product.

## 3. Database provisioning

1. Create a Supabase project (cloud) or stand up a self-hosted stack.
2. Get its API URL + keys (dashboard → Project Settings → API): the **publishable** key (browser-safe) and the **secret** key (server-only, bypasses RLS — guard it).
3. Apply the schema. Pilot never applies migrations automatically at app startup:

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push        # applies supabase/migrations/* — schema + RLS
```

Row-level security is enabled on every table by the migrations; the publishable key can only ever see what policies allow. All sensitive writes go through the server with the secret key.

## 4. Deploying the app

### Option A — Docker Compose (recommended)

```bash
git clone https://github.com/Paylo-One/pilot.git
cd pilot
cp .env.example .env       # edit — see §5
npx supabase link --project-ref <your-project-ref>
npx supabase db push       # explicit, review migrations before production
docker compose up --build -d
```

`NEXT_PUBLIC_*` values are baked into the client bundle at build time, so the compose file passes them as build args — rebuild after changing them (`docker compose up --build`).

### Option B — from source (Node 22)

```bash
git clone https://github.com/Paylo-One/pilot.git && cd pilot
npm ci
cp .env.example .env.local # edit — see §5
npm run build
npm run start              # serves on :3000
```

Put it behind your reverse proxy of choice (Caddy/nginx/Traefik) with a wildcard certificate for `*.yourdomain.com`. Caddy handles wildcard DNS-01 certificates with two lines of config; nginx users will want certbot's DNS plugin.

### Local / single-machine testing without DNS

Set `NEXT_PUBLIC_APP_APEX=lvh.me` and use `http://<slug>.lvh.me:3000` — `*.lvh.me` resolves to 127.0.0.1. (For the full local-dev loop including a local Supabase stack, see the README quick start instead.)

## 5. Configuration reference

Everything is configured via environment variables; `.env.example` is fully annotated. The groups:

### Required

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_APP_APEX` | Your registrable domain (e.g. `example.com`) — tenant subdomains hang off it |
| `PILOT_SIGNUP_MODE` | Set `open` for self-host registration; missing means fail-closed `gated` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-safe Supabase key |
| `SUPABASE_SECRET_KEY` | **Secret.** Server-only; bypasses RLS |
| Model provider — one of: | |
| `OPENAI_API_KEY` | Use hosted OpenAI (simplest) |
| `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL` | Any OpenAI-compatible endpoint (see §7) |

### Optional capabilities

| Group | Variables | Default when unset |
|---|---|---|
| Briefing email | `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` (a sender *you* verified) | Email disabled; job logs a skip |
| Background jobs | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Scheduled ingestion/email don't run |
| News ingestion | `NEWS_INGESTION_TOKEN` | Internal ingest endpoint disabled |
| GitHub connector | `GITHUB_OAUTH_CLIENT_ID/SECRET` | Card shows "Needs credentials" |
| Google connector | `GOOGLE_OAUTH_CLIENT_ID/SECRET` | same |
| Microsoft 365 | `MICROSOFT_OAUTH_CLIENT_ID/SECRET` (+ optional `MICROSOFT_OAUTH_TENANT`) | same |
| Slack / Discord | `SLACK_CLIENT_ID/SECRET`, `DISCORD_CLIENT_ID/SECRET` (+ `DISCORD_BOT_TOKEN`) | same |

Billing variables (`STRIPE_*`, `PADDLE_*`) exist for Paylo One's hosted service; self-hosted instances set `PILOT_SIGNUP_MODE=open` and leave them unset. Open-registration tenants are recorded as complimentary and payment-enforcement-exempt; they never enter the hosted seven-day trial.

## 6. Authentication

- **Magic links** — email via Supabase Auth. On Supabase Cloud, configure the SMTP sender (dashboard → Auth → SMTP) or use the built-in limited sender for testing. Self-hosted Supabase needs an SMTP server configured.
- **Passkeys** — work out of the box: the WebAuthn relying-party ID is derived from `NEXT_PUBLIC_APP_APEX`, so one passkey spans all tenant subdomains. Requires HTTPS in production.
- **First user** — with `PILOT_SIGNUP_MODE=open`, register at `/sign-in`, pick a subdomain at onboarding, and that workspace is yours. Open mode permits additional visitors to create their own workspaces; keep `gated` if the deployment is internet-accessible and you require an allowlist.
- **Legal policy** — open-registration mode does not require acceptance of Paylo One's hosted-service terms. Self-hosting operators are responsible for publishing and enforcing any terms/privacy notice their deployment requires.

## 7. Model providers

All inference goes through the Model Gateway and one OpenAI-compatible configuration point:

- **OpenAI:** set `OPENAI_API_KEY` only.
- **EU-resident / zero-retention:** point `LLM_BASE_URL` at an EU OpenAI-compatible router and explicitly choose provider-valid chat, embedding, and transcription model IDs; `.env.example` leaves these deployment choices blank.
- **Anthropic:** completions are implemented with `ANTHROPIC_API_KEY`; embeddings still require the OpenAI-compatible route.
- **Azure OpenAI / Google:** runtime types exist, but their dedicated adapters are not implemented yet. Do not configure these stub routes in production.
- **Your own endpoint** (vLLM, Ollama via a shim, etc.): set `LLM_BASE_URL` + `LLM_MODEL` accordingly. Embeddings and voice-note transcription use `LLM_EMBEDDING_MODEL` / `LLM_TRANSCRIPTION_MODEL`.

You choose where prompts go. Pilot itself never sends your data anywhere else.

## 8. Integrations

Connectors are read-only OAuth integrations that you register yourself — the app shows "Needs credentials" until each pair is set:

| Provider | Register at | Callback URL | Scopes (read-only) |
|---|---|---|---|
| GitHub | Settings → Developer settings → OAuth Apps | `https://app.<apex>/api/oauth/github/callback` | repo read |
| Google | Cloud Console → OAuth consent + credentials | `https://app.<apex>/api/oauth/google/callback` | Gmail read, Calendar read |
| Microsoft | Entra → App registrations | `https://app.<apex>/api/oauth/microsoft/callback` | Mail.Read, ChannelMessage.Read.All (Graph) |
| Slack | api.slack.com/apps | `https://app.<apex>/api/oauth/slack/callback` | channels:history, channels:read |
| Discord | Developer Portal → OAuth2 + bot | `https://app.<apex>/api/oauth/discord/callback` | messages read (enable Message Content intent) |

**WhatsApp** is hosted-only for now: real ingestion needs a separate bridge runtime that has not yet been open-sourced (see [ROADMAP.md](../ROADMAP.md)). The in-app card runs a guided scaffold without it.

**News Briefing** (RSS + GDELT) needs no credentials; scheduled ingestion uses Inngest or the internal `POST /api/news/ingest` endpoint with `NEWS_INGESTION_TOKEN` — wire that to any cron (e.g. `*/4` hours) if you don't run Inngest.

## 9. Backups

Pilot's state lives entirely in Postgres (plus Supabase Storage if you use file uploads):

- **Supabase Cloud:** enable PITR or scheduled backups in the dashboard.
- **Self-hosted Postgres:** `pg_dump` on a schedule; include the `storage` schema if using uploads.
- Restore drills matter more than backup schedules — test one.

## 10. Upgrades

```bash
git pull --ff-only
# Read CHANGELOG/release notes and review new migration files first.
# Back up, apply migrations, then deploy the matching application version.
npx supabase db push
docker compose up --build -d           # or: npm ci && npm run build && restart
```

Migrations are forward-only and applied in order. Read the release notes before upgrading — pre-1.0, breaking changes are called out explicitly with their migration path. Back up before every upgrade and do not assume an application rollback can reverse a database migration.

## 11. Security hardening checklist

- [ ] `SUPABASE_SECRET_KEY` and all `*_SECRET`/`_KEY` values are set only in the server environment — never in `NEXT_PUBLIC_*`, never committed
- [ ] HTTPS everywhere, with a wildcard certificate for `*.<apex>`
- [ ] SMTP configured with a sender domain you control (magic links carry sign-in authority)
- [ ] Model provider choice reviewed — prompts and completions go to that endpoint
- [ ] OAuth apps scoped read-only, secrets server-side
- [ ] Supabase dashboard access restricted (it *is* your data plane)
- [ ] Database backups scheduled and restore-tested
- [ ] Keep an eye on [SECURITY.md](../SECURITY.md) for disclosure policy and supported versions
