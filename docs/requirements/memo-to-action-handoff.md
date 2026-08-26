# Daily briefing to action handoff

Date: 2026-08-20 (revised 2026-08-26)
Status: Implemented in PR #78

## Problem and intended outcome

Leaders who decide a briefing insight needs follow-up must not retype it or lose where it came from. An operator can carry one briefing section into the existing Actions capture form, edit it, and explicitly confirm creation. A handoff never creates an action by itself.

## Classification and design

Substantial because the confirmed action's existing `created_from` persistent field is part of the action write contract. The simplest complete solution reuses the existing `briefing` value and manual confirmation path. There is no new state owner, schema, dependency, network boundary, vendor, or irreversible element.

Applicable sequence: engineering principles, requirements, architecture and system-design checks, distributed/reliability checks, software design, lifecycle compatibility, and engineering review. Architecture and distribution steps are compressed because this reuses one existing browser boundary and one existing database write.

## Requirements and invariants

- **FR-1:** The handoff is tenant-and-user scoped and consumed once in the same tab. Verified by draft context and consumption tests.
- **INV-1:** Memo content must not appear in a URL, browser history, or infrastructure request log. Verified by the storage interface and navigation inspection.
- **FM-1:** Malformed, older than 15 minutes, future-dated, oversized, or unavailable browser storage must fail without creating an action. Verified by malformed, mismatched-context, age, bounds, and read/write-denial tests plus component inspection.
- **INV-2:** The operator must review and submit through the existing Actions form. Verified by the absence of a write from the handoff component and workspace inspection.
- **FR-2:** A confirmed handoff stores `created_from = 'briefing'`; ordinary quick capture stores `manual`. Verified by the mandatory `createAction` contract and server-action tests.
- **INV-3:** The server boundary allow-lists the supported origin and defaults unrecognised values to `manual`. Verified by boundary tests with omitted and malformed values.
- **INV-4:** No source-reference claim is created: the copied section is editable context, while `created_from` records only the workflow origin. Verified by write-payload inspection.

Latency, throughput, and availability targets are unchanged because the slice adds no request or database round trip. Draft size is bounded to a 200-character title and 1,000-character note. Durability is the established action-write guarantee; the transient draft deliberately has none. No recurring cost is introduced.

## Success signal

The privacy-respecting outcome signal is the number and proportion of explicitly confirmed actions whose existing `created_from` value is `briefing`. Views and clicks are excluded because they do not show workflow completion. No memo text is added to analytics.

## Failure, rollback, and unknowns

Storage denial leaves the operator on the briefing with a visible error. Action-write failure preserves the populated form for retry. Rollback removes the handoff and origin parameter; existing `briefing` rows remain compatible with established readers.

There is no observed user cohort yet, so acceptance rate and downstream completion remain unvalidated. Source-reference attachment is excluded until it can be performed atomically without weakening the trusted write boundary.
