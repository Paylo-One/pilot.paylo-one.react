# Security Policy

## Reporting a vulnerability

**Please do not open public issues for security reports.**

Report vulnerabilities via either:

- **GitHub private vulnerability reporting** — [github.com/Paylo-One/pilot.paylo-one.react/security/advisories/new](../../security/advisories/new)
- **Email** — security@paylo.one

Include: affected version/commit, reproduction steps, impact, and any suggested mitigation. We aim to acknowledge reports within **3 business days** and will keep you informed as we investigate.

We practise coordinated disclosure: we'll agree a public disclosure date with you, targeting **90 days** from report (earlier if a fix ships sooner).

## Scope notes for self-hosters

Pilot is designed to be self-hosted, which means some properties are the operator's responsibility:

- **Secrets management** — all credentials are environment variables; keep `.env` files out of version control and out of client bundles. `SUPABASE_SECRET_KEY` bypasses row-level security and must never reach the browser.
- **TLS + DNS** — tenant routing uses subdomains; production deployments need a wildcard certificate and DNS.
- **Model providers** — prompts and completions flow to whichever inference endpoint you configure. Choose providers whose data handling you accept; an EU-resident, zero-retention router is supported out of the box.
- **OAuth apps** — connectors use OAuth apps *you* register; keep their secrets server-side and scopes read-only as documented.

## What we do in this repo

- Row-level security on every tenant table, verified by a runtime CI test (see `docs/security/` for the audit)
- Server-only access to secret-bearing tables (integration credentials, provider keys, session material)
- Dependency audit gate in CI (high/critical advisories block merges)
- Full-history secret scanning before releases

## Supported versions

Security fixes are applied to `main` and the most recent release. Pilot is pre-1.0 — running the latest release is the supported configuration.
