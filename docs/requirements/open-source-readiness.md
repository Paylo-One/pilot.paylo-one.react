# Open-source readiness requirements

- **Status:** Agreed
- **Created:** 2026-08-11
- **Classification:** Substantial — publishing changes Pilot's external configuration, contributor, security-reporting, and release contracts.

## Problem and scope

Pilot must be safely understandable, runnable, verifiable, and maintainable by people who have no access to Paylo One's private infrastructure or institutional knowledge.

The simplest sufficient outcome is a self-hostable repository with an explicit signup policy, honest capability documentation, reproducible checks, a complete licence/community surface, and no tracked private tooling, personal data, secrets, or machine-local metadata.

Publishing the repository and its configuration contract is difficult to reverse. Repository visibility therefore remains outside this change and requires an explicit owner decision after every release gate passes.

## Stakeholders

| Stakeholder | Need | Served by |
|---|---|---|
| Self-hosting operator | Install without Paylo-controlled billing or invitations | OSS-01, OSS-02, OSS-04 |
| End user | Tenant-isolated, authenticated access | OSS-03, OSS-07 |
| Contributor | Reproducible development and review expectations | OSS-05, OSS-06 |
| Maintainer | Safe disclosure, upgrades, and rollback | OSS-06, OSS-08 |
| Paylo One | Hosted defaults remain fail-closed | OSS-02, OSS-03 |

## Requirements

### Functional

- **OSS-01 (firm):** A clean operator following the documented local setup can install dependencies, apply all database migrations, start Pilot, create an account, create a workspace, and reach the application without Paylo-issued referral codes or Paddle/Stripe credentials.
  - Verification: cold-install procedure plus signup-policy and tenant-provisioning tests.
- **OSS-02 (firm):** Registration policy is explicit configuration with two states: `gated` and `open`. Missing or invalid configuration must not silently enable public registration.
  - Verification: unit tests for default, valid, and invalid values.
- **OSS-03 (firm):** A tenant created through open registration is explicitly complimentary and payment-enforcement-exempt; hosted/gated provisioning retains its current billing path.
  - Verification: provisioning contract test or inspected database payload plus runtime tenant-isolation suite.
- **OSS-04 (firm):** Setup and deployment documentation describes only behaviour the repository implements. Optional, stubbed, hosted-only, and external components are labelled accurately.
  - Verification: documentation-to-code conformance review.
- **OSS-05 (firm):** `npm ci`, lint, typecheck, unit tests, dependency audit, production build, and the runtime RLS integration test are documented and executable in CI or locally.
  - Verification: command evidence and GitHub checks.
- **OSS-06 (firm):** The repository contains licence, notice, contribution, conduct, security, support, changelog, roadmap, issue forms, and pull-request guidance suitable for public contributors.
  - Verification: file and GitHub metadata inspection.
- **OSS-07 (firm):** No tracked current-tree file contains credentials, personal fixtures, private machine paths, linked Supabase project metadata, or developer-only agent/IDE state.
  - Verification: tracked-file scan and secret scan; full-history scan before visibility changes.
- **OSS-08 (firm):** Upgrade instructions preserve data and require backup plus migration review; destructive or incompatible changes cannot be presented as an automatic one-command upgrade.
  - Verification: lifecycle review of upgrade documentation.

### Quality attributes

- **OSS-Q1 Security:** zero known high/critical dependency advisories at release time; tenant isolation must pass against a real local Supabase stack.
- **OSS-Q2 Reproducibility:** Node 22 and the committed lockfile are authoritative; a clean `npm ci` is required.
- **OSS-Q3 Privacy:** no telemetry or phone-home behaviour is introduced by the open-source distribution.
- **OSS-Q4 Supportability:** supported versions and private vulnerability-reporting channels are explicit.
- **OSS-Q5 Portability:** core operation requires Node 22, Supabase, and one implemented model route; Paylo-hosted infrastructure is not required.

## Invariants and never-events

- **INV-01:** Hosted deployments never become open-registration deployments because a variable is missing or malformed.
- **INV-02:** Every tenant remains isolated by database RLS; application checks are not the sole boundary.
- **INV-03:** Server credentials never enter browser-visible `NEXT_PUBLIC_*` configuration or tracked files.
- **INV-04:** Open-registration tenants are never put on an expiring hosted trial.
- **INV-05:** Documentation never claims a provider, migration, or onboarding path that the current code does not implement.

## Constraints and out of scope

- AGPL-3.0-only and trademark treatment follow the existing governance decision; changing licence strategy is out of scope.
- Making the GitHub repository public, renaming it, launching a hosted release, and publishing an npm package are out of scope.
- Open-sourcing the WhatsApp bridge and Paylo's hosted billing/admin infrastructure are out of scope.
- Refactoring unrelated product behaviour or clearing the existing daily-feature PR backlog is out of scope.

## Unknowns resolved first

- Existing OSS PRs were stale only because their dependency lockfile predated the current audit remediation; they are consolidated on current `main`.
- The current signup path is referral/Paddle-gated, so documentation claiming first-user self-hosting was false and requires an explicit open policy.
- Docker Compose does not apply migrations; documentation must retain a separate, explicit provisioning step.
- Azure OpenAI and Google adapters are stubs; documentation must not list them as working providers.
- The Tool Gateway exposes contracts and deny-by-default boundaries but not real execution; the README now labels that boundary explicitly.
