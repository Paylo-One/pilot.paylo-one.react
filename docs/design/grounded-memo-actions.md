# Grounded Daily Memo actions

Date: 2026-08-31  
Status: Implemented in PR #83

## Requirements and boundaries

This design satisfies FR-4, INV-5, and FM-2 in `docs/requirements/memo-to-action-handoff.md`. The browser owns only a 15-minute, same-tab draft. `suggested_actions` owns durable actions and the database function owns the atomic transition from a tenant memo section to an action plus copied references. Tenant and user identity come from the authenticated database session, never from memo text.

## State ownership inventory

| State | Owner | Writer and invariant |
|---|---|---|
| Transient draft and handoff UUID | browser session storage | UI; bounded, tenant/user-context scoped, consumed once |
| Action, section link, handoff UUID | `suggested_actions` | database function; `(tenant_id, created_by, briefing_handoff_key)` is unique |
| Evidence | `source_references` | database function copies only rows already owned by the selected tenant section |

## Options and trade-offs

Copying references in the server action was rejected because action creation could commit while reference copying failed. A database function was selected because both tables share Postgres and one transaction supplies the required consistency without a new service. Automatically creating an action was rejected because explicit operator confirmation is a product invariant. A section-wide uniqueness rule was rejected because one memo section may legitimately lead to multiple distinct actions; a client-generated attempt UUID scopes idempotency to retry/concurrency of one confirmation.

## Failure and distribution analysis

A lost response may be retried with the same handoff key; the unique index returns the original action and does not copy references again. Concurrent calls serialize on the same unique key. A reused key for another section fails closed. Invalid, oversized, foreign-tenant, or foreign-person input fails before durable effects. An uncaught error in either insert aborts the PostgreSQL function transaction. Audit recording occurs after the authoritative transaction and may fail independently; it does not change action correctness.

## Compatibility, rollout, and rollback

The schema expansion is additive and nullable, so old readers and writers remain valid. New code writes the new fields only for memo handoffs. Gate rollout on CI tenant-isolation tests, action-create error rate, duplicate handoff-key count (which must remain zero), and successful action detail reads. Abort on cross-tenant evidence, duplicate keys, or elevated RPC errors. Roll back the application call and UI; leave additive columns/function in place until a later measured-zero contract change. There is no destructive migration or point of no return.

## Requirements conformance

FR-4 maps to the single PostgreSQL function transaction and live evidence-copy/foreign-section tests. INV-5 maps to the partial unique index and retry test. FM-2 maps to validation before inserts and malformed-input tests. The action detail's established reference query makes copied evidence inspectable.
