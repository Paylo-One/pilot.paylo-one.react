# Open-source distribution threat model

- **Status:** Reviewed
- **Created:** 2026-08-11

## Assets and invariants

- Tenant content, OAuth tokens, model-provider keys, Supabase secret key, and authentication sessions remain confidential.
- Tenant A cannot read or mutate Tenant B's state.
- Hosted registration remains gated unless an operator explicitly chooses open registration.
- Published source and history contain no credentials or personal fixtures.

## Trust boundaries

1. **Anonymous internet → authentication and registration:** untrusted email, host, referral, and form input.
2. **Browser → Next.js server:** browser input and publishable Supabase credentials are untrusted.
3. **Next.js server → Supabase:** secret-key access bypasses RLS and therefore requires explicit tenant predicates; ordinary users remain constrained by RLS.
4. **Pilot → model/OAuth/email providers:** prompts, tokens, and user content leave the operator's infrastructure only for providers they configure.
5. **Contributor → repository and CI:** pull requests and dependency changes are untrusted supply-chain input.
6. **Repository → self-hoster:** documentation, container images, defaults, and migrations become an operational trust input.

## Threats and mitigations

| Threat | Concrete path | Mitigation / verification |
|---|---|---|
| Accidental open signup in hosted Pilot | missing/misspelled env value | fail-closed `gated` default; invalid values throw; unit tests |
| Billing coupling blocks self-hosters | onboarding requires referral/Paddle | explicit `open` policy; complimentary/payment-exempt tenant; no hosted trial |
| Cross-tenant access | malicious tenant identifier or missing predicate | RLS on every tenant table; runtime two-tenant integration test |
| Secret disclosure | tracked env, linked Supabase metadata, client bundle | ignore/untrack local state; secret scan; server-only naming and accessors |
| Malicious contribution | dependency confusion, workflow/script change | lockfile, dependency audit, code review, DCO, least-privilege GitHub settings |
| Misconfigured external provider | docs claim unsupported key/provider | capability docs map to implemented adapters; unsupported adapters labelled |
| Unsafe upgrade | operator applies migration without backup/review | backup-first upgrade runbook; release notes and migration review required |
| Vulnerability disclosed publicly | reporter uses an issue | SECURITY policy, private advisories, dedicated email, issue-form warning |

## Residual risks

- Operators control DNS, TLS, Supabase, backups, SMTP, OAuth applications, and model providers; insecure operator configuration cannot be prevented by application code.
- Repository history contains previously tracked non-secret infrastructure identifiers. A fresh history scan is mandatory immediately before visibility changes; history rewriting is a separate, irreversible owner decision.
- Open registration intentionally allows anyone who can reach a public self-host to create an account and workspace. Operators that do not want this must keep `PILOT_SIGNUP_MODE=gated` and provide their own referral/payment path.

## Review triggers

Re-review when adding a public plugin API, a new identity provider, a new registration mode, automatic database migrations, a published container image, or any telemetry.
