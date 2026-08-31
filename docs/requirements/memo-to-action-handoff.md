# Daily briefing to action handoff

Date: 2026-08-20 (revised 2026-08-28)
Status: Implemented in PR #78; evidence preservation pending in PR #83

## Problem and intended outcome

Leaders who decide a briefing insight needs follow-up must not retype it or lose where it came from. An operator can carry one briefing section into the existing Actions capture form, edit it, and explicitly confirm creation. A handoff never creates an action by itself.

## Classification and design

**Classification: Critical.** The problem is that an operator-confirmed follow-up loses the evidence needed to judge why it matters. Evidence preservation adds a persistent relationship and an authenticated `SECURITY DEFINER` database write contract, making the work security-sensitive. The simplest complete outcome is one explicitly confirmed, evidence-backed action per handoff attempt, created atomically at the database owner. The full constitution sequence applies: principles, requirements, architecture, system/distribution/reliability design, software design, lifecycle, and fresh-context adversarial review. No element is irreversible: the additive columns and function may remain unused after application rollback, and copied references remain valid. Top unknowns are direct-RPC abuse, cross-tenant association, retry duplication, and whether evidence improves action outcomes.

Applicable sequence: engineering principles, requirements, architecture and system-design checks, distributed/reliability checks, software design, lifecycle compatibility, and engineering review. Architecture and distribution steps are compressed because this reuses one existing browser boundary and one existing database write.

## Requirements and invariants

- **FR-1:** The handoff is tenant-and-user scoped and consumed once in the same tab. Verified by draft context and consumption tests.
- **INV-1:** Memo content must not appear in a URL, browser history, or infrastructure request log. Verified by the storage interface and navigation inspection.
- **FM-1:** Malformed, older than 15 minutes, future-dated, oversized, or unavailable browser storage must fail without creating an action. Verified by malformed, mismatched-context, age, bounds, and read/write-denial tests plus component inspection.
- **INV-2:** The operator must review and submit through the existing Actions form. Verified by the absence of a write from the handoff component and workspace inspection.
- **FR-2:** A confirmed handoff stores `created_from = 'briefing'`; ordinary quick capture stores `manual`. Verified by the mandatory `createAction` contract and server-action tests.
- **INV-3:** The server boundary allow-lists the supported origin and defaults unrecognised values to `manual`. Verified by boundary tests with omitted and malformed values.
- **FR-4:** A confirmed handoff atomically copies the selected memo section's existing source references onto the action. The trusted database boundary verifies that the section belongs to the active tenant before either the action or references are written. Verified by boundary and tenant-isolation tests.
- **INV-5:** Repeating or concurrently submitting the same handoff key creates exactly one action. Reusing a key for a different section fails closed. Verified by database uniqueness and live retry tests.
- **FM-2:** The database boundary rejects missing keys, non-object or over-32 KiB payloads, titles outside 1–200 characters, descriptions over 1,000 characters, rationales over 2,000 characters, and more than 20 topics or 100 characters per topic. Verified by boundary inspection and live malformed-input tests.

Latency, throughput, and availability targets are unchanged because the slice adds no request or database round trip. Draft size is bounded to a 200-character title and 1,000-character note. Durability is the established action-write guarantee; the transient draft deliberately has none. No recurring cost is introduced.

## Success signal

The privacy-respecting outcome signal is the number and proportion of explicitly confirmed actions whose existing `created_from` value is `briefing`. Views and clicks are excluded because they do not show workflow completion. No memo text is added to analytics.

## Failure, rollback, and unknowns

Storage denial leaves the operator on the briefing with a visible error. Action-write failure preserves the populated form and its key for an idempotent retry. Old readers ignore the additive nullable columns. Rollback removes the handoff UI and stops calling the function; existing actions and copied references remain valid.

There is no observed user cohort yet, so acceptance rate, downstream completion, and the effect of preserved evidence remain unvalidated.
