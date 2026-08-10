## What & why

<!-- One focused change per PR. Describe the *why* — the diff shows the *what*. Link the issue/Discussion. -->

## How to verify

<!-- Steps a reviewer can follow locally. Include migrations, env changes, or setup notes if any. -->

## Checklist

- [ ] `npm run lint`, `npm run typecheck`, and `npm test` pass
- [ ] Tests added/updated for behaviour changes
- [ ] New tables/migrations preserve RLS (the tenant-isolation suite must stay green)
- [ ] No secrets, credentials, or personal data added
- [ ] No telemetry or phone-home behaviour added
- [ ] Commits signed off (`git commit -s`) per the DCO in [CONTRIBUTING.md](../blob/main/CONTRIBUTING.md)
- [ ] Docs updated (README / docs/ / .env.example) where behaviour or config changed
