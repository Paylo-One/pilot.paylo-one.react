# ADR-053 — Separate tenant access authority from billing lifecycle

- **Status:** Proposed — **requires Bernard's approval.** Supersedes the accepted
  enforcement posture in `governance/docs/02-monetisation/billing-subscription-logical-design.md`
  §6.6, §7.1, §8.2 if accepted. Draft PR is intentionally **not merged**.
- **Date:** 2026-07-16
- **Context tags:** monetisation, access-control, billing, admin-operations, data-model
- **Relates to:** ADR-045 (EU inference), governance decision log
  `2026-07-11-launch-billing-surface.md`, OQ-10 (feature gating).

## Context

Today two concerns are conflated in one field. The accepted launch design ties
**application access** directly to **subscription/payment state**: `past_due`
and `grace` pause AI/ingestion, and `suspended`/`expired`/`cancelled` collapse a
tenant's entitlements to a locked baseline (see logical design §6.6/§7.1/§8.2,
and the former `applyAccountState` step in `modules/billing/entitlements.ts`).
The prior `admin_set_subscription_status` RPC also mutated `tenants.status` as a
side effect of a billing-state change.

This coupling has three problems for a premium, invite-only product with
complimentary/beta tenants and manual founder-rate arrangements:

1. **No safe way to grant access without a live paid subscription.** Beta and
   complimentary tenants must either be given a fake subscription or risk being
   auto-locked by dunning automation.
2. **Payment retries can silently degrade a paying customer's product.** A
   transient failed charge (`past_due`) pauses AI/ingestion even though the
   operator has done nothing wrong and payment is still being retried.
3. **Access changes are a side effect, not an auditable decision.** Suspending a
   tenant "for real" (abuse, compliance, security) has no first-class,
   reason-coded, audited path distinct from ordinary dunning.

## Decision proposed

Make `tenants.status` the **single authority** for application access, and treat
subscription/payment state as an **operational signal only**.

- `tenants.status = 'active'` → protected features available (subject to plan
  entitlements and overrides).
- `tenants.status = 'suspended'` → protected features locked; only the
  account-inactive screen and sign-out remain reachable.
- Payment states (`past_due`, `grace`, `expired`, `cancelled`, `unpaid`) no
  longer collapse entitlements on their own. They drive billing banners and
  operational alerts; converting a payment problem into an access change is an
  explicit, audited administrative act.

Supporting mechanics (migration `20260715120000_tenant_access_lifecycle`):

- New `tenants` policy columns: `access_grant_type` (paid | complimentary |
  beta_exempt), `payment_enforcement_exempt`, `manual_override_active`,
  `is_beta`, and suspension/reactivation provenance columns.
- `admin_set_subscription_status` is now **billing-only** (no longer mutates
  `tenants.status`).
- `admin_set_tenant_access(active, reason_code, reason, …)` — the only
  active↔suspended write path; requires a reason code
  (`non_payment | abuse | compliance | security | administrative`) and refuses
  to suspend while `manual_override_active`. Fully audited.
- `admin_set_tenant_access_policy(…)` — sets grant type / exemptions / manual
  override; `complimentary`/`beta_exempt` imply payment-enforcement exemption.
- Legacy `billing_access` rows are still written as a **compatibility
  projection**; runtime authorization never reads them.

Resolver precedence becomes: **tenant access → plan defaults → active add-ons →
admin overrides** (tenant access highest). A suspended tenant collapses to
`LOCKED_BASELINE`; dunning states retain plan capabilities.

## Consequences

**Positive**

- Complimentary/beta/founder-rate tenants are first-class and cannot be
  auto-locked by billing automation.
- Paying customers are not degraded by transient payment retries.
- Suspension becomes a reason-coded, audited, reversible decision with clear
  provenance — better for compliance/abuse handling.

**Costs / risks**

- **Monetisation-policy change.** Non-payment no longer *automatically* restricts
  access. Revenue protection now depends on an explicit dunning→suspend policy
  (manual or a future automated job) rather than the entitlement resolver. This
  must be a deliberate business choice, hence approval-gated.
- **Cross-repo work required.** The admin portal
  (`pilot-admin.paylo-one.react`) must expose the new RPCs; any admin flow that
  relied on `admin_set_subscription_status` to suspend a tenant must move to
  `admin_set_tenant_access`.
- **Docs conflict.** Contradicts accepted logical design §6.6/§7.1/§8.2; those
  sections are flagged with a pending-change note and must be rewritten on
  acceptance.
- **Pre-merge polish.** `account-inactive` copy is currently literal and must be
  moved into the next-intl `account` namespace for all locales (draft only).

## Recommended implementation approach (if accepted)

1. Accept and rewrite logical design §6.6/§7.1/§8.2 to the access/billing split.
2. Merge this migration; backfill `access_grant_type` for existing tenants
   (default `paid`, set beta/complimentary tenants explicitly).
3. Land admin-portal UI for `admin_set_tenant_access` /
   `admin_set_tenant_access_policy` with the reason-code capture.
4. Define the dunning→suspension policy (SLA/automation) so revenue protection
   is intentional, not implicit.
5. Re-add i18n keys for the account-inactive screen.

## Verification (draft branch)

`npm run typecheck`, `npm run lint`, and `npx vitest run` all pass
(145 passed / 2 skipped) on top of current `main`. The SQL migration has not
been executed against a database in this iteration.
