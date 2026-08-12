# Pilot

**The open-source personal AI assistant that briefs you every morning.**

Pilot reads the sources you connect — email, calendar, chat, files, news — and turns them into a calm, cited daily briefing: what matters, what's waiting on you, and what you can ignore. It runs on your own infrastructure, with your own model keys, and your data never has to leave your control.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![CI](https://github.com/Paylo-One/pilot.paylo-one.react/actions/workflows/ci.yml/badge.svg)](https://github.com/Paylo-One/pilot.paylo-one.react/actions/workflows/ci.yml)

> **Self-host it, or let us run it:** Pilot is open source (AGPL-3.0). If you'd rather skip the infrastructure, [Pilot by Paylo One](https://paylo.one) is the managed, hosted version of this same codebase.

---

## The problem

If you lead things, your real inputs are scattered across a dozen tools — inbox, calendar, WhatsApp, Teams, Slack, GitHub, documents, news. Every "AI assistant" wants to either lock that context inside a vendor's cloud, or hand you a framework and wish you luck building the product yourself.

## Why Pilot

- **A briefing, not a chatbot.** Pilot's core loop is the Daily Memo — a synthesised, prioritised morning brief with an actions queue, not another prompt box.
- **Provenance-first.** Claims in your briefing link back to the source items they came from. You can check what the AI told you — the point is trust, not vibes.
- **Self-hosted and private.** Postgres + your own API keys. No telemetry, no phone-home, no usage reporting. Your data stays on infrastructure you control.
- **Bring your own models.** Route inference through OpenAI, an OpenAI-compatible endpoint, or Anthropic. Embeddings currently require the OpenAI-compatible path.
- **A working core with honest edges.** Multi-tenant workspaces, passkey auth, row-level security, i18n, and the Daily Memo are implemented; incomplete gateways and hosted-only components are labelled rather than presented as finished.

## Major capabilities

- **Daily Memo** — a generated morning briefing from your connected sources, with per-item source references
- **Actions queue** — extracted follow-ups and commitments, with in-app notifications and an optional daily email
- **Diary** — a private, voice-note-capable journal that feeds your context
- **People & companies** — an automatically built picture of who you deal with, correlated across sources
- **News Briefing** — optional tenant-scoped news monitoring (RSS + GDELT) folded into your brief
- **Source connectors** — file/paste upload, GitHub, Google (Gmail + Calendar), Microsoft 365 (Mail + Teams), Slack, Discord — read-only, OAuth, your own apps
- **Passkey-first auth** — native WebAuthn via Supabase, magic link as fallback
- **Model Gateway** — policy, routing, usage + audit in front of every inference call
- **Tool Gateway (MCP)** — contracts, risk classification, and deny-by-default HTTP boundaries are present; real tool execution is still a scaffold
- **Multi-tenant** — subdomain workspaces with Postgres RLS isolation (proven in CI)

## Architecture at a glance

A **modular monolith**: one deployable Next.js app, organised into `modules/*` with typed interfaces and enforced boundaries.

```
app/             Next.js App Router — marketing apex, auth, tenant app, APIs
modules/         the services: briefing, actions, diary, people, ingestion,
                 source-connection, model-gateway, tool-gateway (MCP), audit…
lib/             env-backed config (secrets only in env), Supabase clients
proxy.ts         host-based tenant resolution + auth gate
supabase/        migrations — schema + RLS on every table
```

- **Stack:** Next.js (App Router) · React 19 · TypeScript · Supabase (Postgres + Auth + Storage + pgvector) · Tailwind 4 · next-intl
- **Tenancy:** tenant-per-subdomain, server-side re-derivation, RLS as the database backstop — verified by a runtime CI test that boots the full stack and proves tenant A cannot read tenant B
- **Inference:** shared OpenAI-compatible configuration covers the implemented model paths; the Model Gateway also supports Anthropic completions. Azure OpenAI, Google, and vLLM-specific adapters remain explicit stubs.

## Quick start (local development)

**Prerequisites:** Node 22+, Docker (for the local Supabase stack), and the [Supabase CLI](https://supabase.com/docs/guides/local-development).

```bash
git clone https://github.com/Paylo-One/pilot.paylo-one.react.git
cd pilot.paylo-one.react
npm ci
npx supabase start         # local Postgres/Auth/Storage (API :54321, Mailpit :54324)
npx supabase db reset      # apply schema + RLS migrations
cp .env.example .env.local # map local Supabase keys; set PILOT_SIGNUP_MODE=open and a model key
npm run dev
```

Then:

1. Open `http://lvh.me:3000/sign-in` and request a magic link
2. Read it in Mailpit at `http://127.0.0.1:54324`
3. Pick a workspace subdomain at `/onboarding` — you land at `http://<slug>.lvh.me:3000`

`*.lvh.me` resolves to 127.0.0.1, so subdomains work locally without DNS. File/paste upload works immediately; OAuth connectors work once you register the corresponding app (see [Integrations](#integrations)).

## Self-hosting in production

Pilot is a standard Next.js server plus Postgres — it runs anywhere Node 22 does. The shortest path:

```bash
git clone https://github.com/Paylo-One/pilot.paylo-one.react.git
cd pilot.paylo-one.react
cp .env.example .env       # fill in: Supabase, model provider, app apex, signup policy
npx supabase link --project-ref <ref>
npx supabase db push       # explicit: Compose never mutates your database
docker compose up --build
```

Full guide — infrastructure requirements, every environment variable, authentication, model providers, connector setup, backups, upgrades, and security hardening: **[docs/self-hosting.md](docs/self-hosting.md)**.

## Configuration

Everything sensitive is an environment variable; `.env.example` is the annotated reference. The essentials:

| Variable | Purpose |
|---|---|
| `PILOT_SIGNUP_MODE` | `open` for self-host registration; defaults to fail-closed `gated` |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` | Database + auth (publishable = browser, secret = server-only, bypasses RLS) |
| `OPENAI_API_KEY` (or `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL`) | Model provider — any OpenAI-compatible endpoint works |
| `NEXT_PUBLIC_APP_APEX` | Registrable domain for tenant subdomains (e.g. `example.com`; wildcard DNS required) |
| `*_OAUTH_CLIENT_ID` / `*_OAUTH_CLIENT_SECRET` | Optional per-connector OAuth apps |
| `SENDGRID_API_KEY` / `SENDGRID_FROM_EMAIL` | Optional daily briefing email (unset = email disabled) |
| `INNGEST_*` | Optional durable background jobs (news ingestion, briefing email) |

## Integrations

| Connector | Status | What you need |
|---|---|---|
| Files / paste | Works out of the box | nothing |
| GitHub | Self-host ready | GitHub OAuth app (read-only) |
| Google (Gmail, Calendar) | Implemented; setup validation required | Google OAuth client (read-only scopes) |
| Microsoft 365 (Mail, Teams) | Implemented; setup validation required | Entra app registration (read-only) |
| Slack / Discord | Implemented; setup validation required | OAuth app / bot with the documented scopes |
| News (RSS + GDELT) | Self-host ready | nothing (GDELT is public) |
| WhatsApp | **Hosted-only for now** | requires a separate bridge runtime that is not yet open-sourced — the in-app card runs a guided scaffold |

Each connector shows "Needs credentials" in the UI until its OAuth pair is set. Setup walkthroughs: [docs/self-hosting.md](docs/self-hosting.md#integrations).

## Security

- Row-level security on **every** tenant table, enforced by Postgres and tested in CI ([audit](docs/security/2026-07-11-tenant-isolation-rls-audit.md))
- Secret-bearing tables (credentials, provider keys, session material) are server-only by default
- All secrets via environment variables — nothing sensitive in the repo, ever
- No telemetry, no analytics, no phone-home
- Report vulnerabilities privately per **[SECURITY.md](SECURITY.md)** — please don't open public issues for security reports

## Contributing

Contributions are welcome — connectors, self-hosting improvements, bug fixes, docs. Read **[CONTRIBUTING.md](CONTRIBUTING.md)** (DCO sign-off, no CLA), check the **good first issue** label, and say hello in [Discussions](https://github.com/Paylo-One/pilot/discussions).

## Roadmap

See **[ROADMAP.md](ROADMAP.md)** — near-term: self-host polish, more connectors, and open-sourcing the WhatsApp bridge.

## Pilot and Paylo One

Pilot is open source under **AGPL-3.0** — see [LICENSE](LICENSE). [Paylo One](https://paylo.one) is the company stewarding the project and selling the **managed, hosted version**: same codebase, plus operated infrastructure, pre-configured integrations, onboarding, and support. The open-source edition is not artificially limited — if you can run it, you get all of it.

"Pilot", the logo, and Paylo One branding are trademarks of Paylo One and are **not** licensed under the AGPL — forks are welcome, but may not present themselves as Pilot.

---

*Know what matters. Lose the noise.*
