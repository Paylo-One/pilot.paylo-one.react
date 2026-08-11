# Contributing to Pilot

Thanks for being here. Pilot is a young open-source project stewarded by [Paylo One](https://paylo.one) — small team, real reviews, no bots pretending to be maintainers.

## Before you start

- **Bug?** Open an [issue](../../issues/new/choose) — reproduction steps beat essays.
- **Feature or idea?** Start a [Discussion](../../discussions) first. We keep the roadmap deliberately small, and a quick conversation saves you writing a PR we can't take.
- **Not sure where to begin?** The [`good first issue`](../../labels/good%20first%20issue) label is maintained and genuinely means it.

## Ground rules

1. **Secrets never enter the repo.** All credentials are environment variables (see `.env.example`). If you find a committed secret, report it per [SECURITY.md](SECURITY.md).
2. **RLS is non-negotiable.** Every tenant table keeps row-level security; write access flows through the server. The CI tenant-isolation suite must stay green — if your migration adds a table, the tests will notice.
3. **Module boundaries.** Code lives in `modules/*` behind typed interfaces; modules never reach into each other's internals.
4. **No telemetry.** Do not add analytics, tracking, or phone-home behaviour. PRs that do will be closed.
5. **Tests + checks.** `npm run lint`, `npm run typecheck`, `npm run check:oss`, and `npm test` must pass. Add tests for behaviour changes.

## Development setup

See the [README](README.md#quick-start-local-development) — `npx supabase start`, `npm run dev`, and you're at `http://lvh.me:3000`. To run the full CI suite locally (needs Docker + Supabase CLI): `npm run ci:local`.

## Contributor licence: DCO, not CLA

We use the [Developer Certificate of Origin](https://developercertificate.org/) — no CLA paperwork. By signing off your commits you certify you wrote the change (or have the right to submit it) and that it may be distributed under the project's AGPL-3.0 licence.

Sign off with:

```bash
git commit -s
```

which adds `Signed-off-by: Your Name <you@example.com>` to your commit message. That's the whole process.

## Pull requests

- One focused change per PR; fill in the template.
- Describe *why*, not just *what* — the diff shows the what.
- Expect a real review from a human, usually within a few days. We'd rather be slow and honest than fast and rubber-stamping.

## What belongs where

- **Open source (this repo):** the Pilot application, connectors, self-hosting, docs, extension points.
- **Not here:** Paylo One's hosted-infrastructure config, billing, marketing site, or admin tooling — those are private by design (see the README's *Pilot and Paylo One* section). PRs can't add them, and that's intentional, not a slight.

## Code of conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — the short version: be decent.
