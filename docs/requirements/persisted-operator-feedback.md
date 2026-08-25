# Requirements: Persisted operator feedback

- **Status:** Agreed
- **Date:** 2026-08-14
- **Author:** Pleco (automated product owner)
- **Work classification:** Substantial — triggered by a new write across the client/server/database trust boundary

## 1. Problem Statement

Daily Memo refinement controls acknowledge an operator's correction without retaining it. This breaks the trust contract: the interface implies that Pilot learned something while a reload discards the input and no later system can use it.

The simplest complete outcome is durable capture of the existing one-tap feedback event. Applying feedback to ranking or creating standing rules is deliberately separate because operator-visible, reversible rule management does not exist yet. A local-only acknowledgement is rejected because it reproduces the defect.

The change is reversible and adds no table or column, dependency, vendor, destructive data step, or public API. The existing `user_feedback_events` table remains the sole state owner. Its insert policy must be hardened additively in deployment terms to enforce authenticated user attribution; existing rows and reads remain compatible. The main unknown is whether the RLS/auth path accepts a correctly attributed tenant member's insert while rejecting forged tenant or user attribution; this is verified through the server-action contract tests and the tenant-isolation suite.

Applicable constitution sequence: engineering principles → requirements → architecture analysis (compressed: no expensive-to-reverse decision) → system design (compressed below: existing component and state) → distributed/reliability analysis → software design → lifecycle → adversarial review.

## 2. Stakeholders

| Stakeholder | Type | Need |
|---|---|---|
| Workspace operator | User | Know that acknowledged feedback was retained, or see an actionable failure. |
| Refinement/briefing pipeline | System | Receive tenant- and user-attributed events in the existing canonical store. |
| Future maintainers/support | Operator | Diagnose feedback capture without sensitive content in telemetry. |

## 3. Functional Requirements

| ID | Requirement | Stability | Verified by |
|---|---|---|---|
| FR-1 | Given a valid one-tap feedback request, the system stores one event attributed to the authenticated user and server-derived tenant before showing success. | F | Server-action unit test |
| FR-2 | Given invalid feedback, target type, target id, or event id, the system rejects the request without a database write. | F | Server-action unit tests |
| FR-3 | Given a database failure, the control remains unapplied and shows an inline error; it can be retried. | F | Server-action and component inspection |
| FR-4 | Replaying the same event id has one durable effect and returns success only when the existing event belongs to the same tenant, user, and payload. | F | Server-action unit tests |
| FR-5 | Daily Memo sections expose one-off relevance feedback and label success as saved feedback, without implying that a standing rule or current entity state changed. | F | Briefing and component inspection |
| FR-6 | Reloading the current Daily Memo preserves the signed-in operator's saved state and prevents a duplicate submission from that control. | F | Read-path unit test and component inspection |
| FR-7 | If saved feedback state cannot be read, the Daily Memo remains readable while its feedback controls are disabled and explain that feedback is temporarily unavailable. | F | Read-path failure test and component inspection |
| FR-8 | An operator can undo saved `not_relevant` feedback; the correction is append-only and the latest relevance event determines visible state. | F | Server-action, read-path, and presentation tests |

## 4. Quality Attributes

| ID | Attribute | Target | Hard limit | Verified by |
|---|---|---|---|---|
| QA-1 | Latency | One database write on the interaction path | No application retry | Design inspection |
| QA-2 | Availability | No new target; fail visibly with retry available | Never acknowledge a failed write | Unit test |
| QA-3 | Throughput | Existing interactive use; no stated 12-month forecast | One in-flight submission per control | Component inspection |
| QA-4 | Durability | Same as the existing Supabase table | Success only after confirmed insert/replay | Unit test |
| QA-5 | Security | Tenant and user are never accepted from the client | Zero cross-tenant attribution | Unit + tenant-isolation suite |
| QA-6 | Auditability | Event id, target, type, tenant and user retained | No hidden learning or rule mutation | Schema/code inspection |
| QA-7 | Cost | No new vendor or recurring service | Existing database only | Dependency diff inspection |

## 5. Invariants and Never-Events

| ID | Invariant / never-event | Enforced by | Verified by |
|---|---|---|---|
| INV-1 | A client cannot choose the event's tenant or forge another user's authorship. | `requireTenantContext` plus tenant-and-user RLS predicates | Unit + tenant-isolation suite |
| INV-2 | The UI never displays applied state before persistence succeeds. | `FeedbackChip` transition result handling | Failure-path test/inspection |
| INV-3 | One event id cannot produce more than one durable event or be reused to acknowledge a different payload. | Primary key plus replay comparison | Unit tests |
| INV-4 | Capturing feedback does not silently create or apply a standing rule. | Refinement action scope | Code inspection |
| INV-5 | Feedback controls do not promise persistent priority, inclusion, muting, or relationship changes until those effects are implemented and inspectable. | Feedback surface copy and allowed affordances | Component inspection |
| INV-6 | Saved state is attributed to the current tenant and operator; one tenant member's feedback is never presented as another member's feedback. | Tenant/user-filtered read under RLS | Unit test and RLS integration coverage |
| INV-7 | Correcting feedback never deletes or rewrites the original event. | A new `relevant` event through the existing insert-only boundary | Server-action test and grant inspection |

## 6. Failure-Mode Requirements

| ID | Condition | Required behaviour |
|---|---|---|
| FM-1 | Invalid or oversized input | Reject before database access with a safe message. |
| FM-2 | Duplicate/replayed event id | Confirm identical owned event; otherwise reject. |
| FM-3 | Database down, slow, or errors | Surface failure; allow a fresh user retry; do not mutate UI to applied. Supabase/request infrastructure owns timeouts. |
| FM-4 | Concurrent submission from one control | Disable the control while the request is pending. |
| FM-5 | Process crash after commit before response | A replay with the same id resolves to the existing identical event. |
| FM-6 | Saved-state read fails | Keep the briefing available, log the failure without memo content, and disable feedback so unknown state cannot be presented as unsaved. |
| FM-7 | Save and correction have the same timestamp | Use event id as a deterministic secondary sort key; concurrent cross-tab intent remains last-database-order wins. |

## 7. Constraints

- Use the existing `user_feedback_events` table and read policy; replace its insert policy with tenant-membership plus `user_id = auth.uid()` enforcement.
- Derive tenant and user at the trusted server boundary.
- No telemetry, new dependencies, hidden model learning, or rule application. A patch-level lockfile update is permitted only to resolve a security advisory discovered by required verification.

## 8. Out of Scope

- Applying events to Daily Memo ranking.
- Creating, editing, pausing, or deleting standing rules.
- A feedback-history or rules-management screen.
- Editing or deleting an append-only event.

## 9. Requirement Conflicts and Priorities

Durable, truthful acknowledgement outranks instant optimistic feedback. The extra database round trip is accepted because the interaction is low frequency and trust-critical.

On 2026-08-25, the earlier deferral of undo was revisited after the persisted UI made accidental feedback effectively irreversible. Deletion was rejected because it would break the audit contract. A positive `relevant` event was selected as the smallest correction model: it preserves history, uses the existing state owner and authorization boundary, and is reversible by another explicit event.

## 10. Design and Failure Analysis

`modules/refinement/actions.ts` owns the server action contract and writes the existing refinement-owned table through the authenticated Supabase client. `FeedbackChip` owns only interaction state. Input crosses the client/server trust boundary and is allow-listed and length-bounded; tenant/user attribution is server-derived.

The request can be lost, delayed, or return after a commit. The client performs no automatic retry. A caller-generated UUID is the idempotency key; duplicate inserts are reconciled by reading the authoritative row and accepting only an exact tenant/user/payload match. Relevance-event ordering is derived from database `created_at`, then event id for deterministic ties. A correction is another append-only observation, so there is one database write and no dual write. Cross-tab simultaneous opposite inputs are last-database-order wins; the normal control prevents concurrent input locally. Old code and existing rows remain compatible and ignore the new event type; rollback is removal of the undo affordance and latest-state interpretation, with retained correction events harmless. Rollout abort signal: feedback write errors, incorrect saved-state reconstruction, or tenant-isolation failures; rollback by reverting the application commit.

## 11. Open Questions

| # | Question | Blocking? | Owner | Resolution |
|---|---|---|---|---|
| 1 | Which feedback should become an explicit standing rule? | No | Product owner | Separate slice after an inspect/edit rules surface exists. |
