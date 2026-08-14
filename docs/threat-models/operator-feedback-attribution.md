# Threat model: Operator feedback attribution

- **Status:** Reviewed
- **Date:** 2026-08-14
- **Scope:** `user_feedback_events` inserts from the Daily Memo and direct authenticated PostgREST access

## Assets and trust boundaries

Feedback events are tenant-scoped audit inputs that may later influence briefing behaviour. Browser input crosses the server-action boundary; authenticated users can also reach Supabase PostgREST directly. Tenant and user attribution must therefore be enforced where the data lives, not only in the server action.

## Threats and controls

| Threat | Impact | Control | Verification |
|---|---|---|---|
| Client selects another tenant | Cross-tenant poisoning | Existing membership-based RLS predicate | Runtime isolation test |
| Tenant member forges another user's authorship | False audit attribution | Insert policy requires `user_id = auth.uid()` | Runtime isolation test |
| Malformed/oversized server-action payload | Exception or storage abuse | Runtime allow-lists, UUID validation, 200-character target limit | Unit tests |
| Lost response after commit | Duplicate feedback | Stable UI idempotency key and exact replay reconciliation | Unit tests and inspection |
| Database/network failure | False success | Fail closed with retryable inline error | Unit tests and inspection |

## Residual risk

Any tenant member can submit feedback for an arbitrary target identifier within the 200-character bound. This is acceptable while events are inert audit inputs and no rule engine consumes them. Before events influence ranking, the target must be resolved within the tenant at the trusted boundary.

## Rollback

Revert the application invocation first. The stricter insert policy can remain safely; if rollback is required, restore the prior tenant-only policy only with an explicit acceptance of forged user attribution.
