# Open-source release readiness

- **Status:** In review
- **Created:** 2026-08-11
- **Owner:** Paylo One

This gate covers source distribution. It does not authorize changing repository visibility.

## Correctness and verification

- [ ] Requirements and invariants map to implementation and tests
- [ ] Clean `npm ci`, lint, typecheck, unit tests, dependency audit, and production build pass
- [ ] `npm run check:oss` passes and remains part of CI
- [ ] Runtime tenant-isolation test passes against a fresh Supabase stack
- [ ] Open registration and complimentary tenant provisioning are verified
- [ ] Fresh-context adversarial engineering review is approved

## Security and privacy

- [ ] Current tree secret scan passes
- [ ] Full Git history secret scan passes immediately before visibility change
- [ ] No tracked `.env`, Supabase linked-project state, IDE settings, agent tooling, personal fixtures, or private strategy documents
- [ ] Dependency audit reports zero high/critical vulnerabilities
- [ ] Private vulnerability reporting is enabled on GitHub
- [ ] Branch protection requires CI and review

## Distribution and operations

- [ ] Licence and NOTICE approved by the owner
- [ ] README and self-hosting guide pass a clean-machine walkthrough
- [ ] Container build and health check pass
- [ ] Database provisioning and upgrade steps are explicit, backup-first, and non-destructive by default
- [ ] Supported-version and coordinated-disclosure policy published
- [ ] Repository description, homepage, topics, Discussions, issue forms, and PR template configured

## Release procedure

1. Merge the consolidated readiness PR only when CI and review are green.
2. Close superseded OSS PRs #51 and #52 after confirming their commits are present.
3. Run the full-history secret scan against the final `main` SHA.
4. Confirm licence choice and trademark notice with the owner.
5. Enable private vulnerability reporting, Discussions, branch protection, and required checks.
6. Rename the repository only if desired; update links and CI badges atomically.
7. Change visibility as a separate owner-approved action.
8. Tag the first release only after a clean-install smoke test from the public URL.

## Rollback

Before visibility changes, rollback is closing the PR. After visibility changes, making the repository private again does not retract clones; therefore publication is the point of no return and requires explicit owner approval.
