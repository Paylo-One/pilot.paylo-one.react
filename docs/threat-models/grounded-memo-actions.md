# Threat model: grounded Daily Memo actions

Date: 2026-08-31  
Scope: Browser draft, Next.js server action, authenticated Postgres function, actions and source references.

## Assets and trust boundaries

Assets are tenant memo evidence, action content, authorship, and tenant association. Untrusted browser data crosses the server-action boundary and authenticated users may invoke the granted database function directly. The function therefore treats tenant IDs, section IDs, people IDs, keys, and action JSON as hostile. Supabase authentication and `auth_tenant_ids()` form the identity/membership boundary.

| Threat | Effect | Control | Verification |
|---|---|---|---|
| Forge another tenant or section | Cross-tenant disclosure/association | `auth.uid()` membership plus section/person tenant checks | two-tenant runtime test |
| Bypass browser bounds | resource abuse or invalid durable state | database object/byte/field/topic bounds and table constraints | malformed/oversized runtime test |
| Retry or race one confirmation | duplicate actions/evidence | user-and-tenant-scoped unique handoff UUID | retry runtime test |
| Reuse a key for another section | confused-deputy association | persisted section comparison; fail closed | database function inspection/test |
| Failure between writes | unattributed action | one PostgreSQL function transaction | transaction semantics plus evidence-copy runtime assertion |
| Definer privilege escalation | write beyond narrow purpose | empty search path, fully qualified objects, explicit revoke/grant, fixed created user/origin | migration inspection and direct authenticated tests |

## Residual risk and response

Postgres must parse JSON before the function can reject its size; upstream Supabase request limits remain defence in depth. Audit recording can fail after action commit, so operational diagnosis uses the durable action and handoff key first. Any cross-tenant evidence association or duplicate persisted key is a release-abort condition.
