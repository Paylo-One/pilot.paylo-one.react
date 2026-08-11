# ADR-054: Daily Memo quota follows the operator's local day

- **Date:** 2026-08-11
- **Status:** Accepted
- **Scope:** Pilot product runtime
- **Relates to:** governance `docs/product/daily-memo.md` (local-day trust
  contract), `docs/services/briefing.md` (tenant-timezone scheduling)

## Context

Pilot schedules and presents the Daily Memo in the operator's configured IANA
timezone. The observe-only `maxBriefingsPerDay` guard did not share that clock:
it counted briefings since UTC midnight. Near midnight, a regeneration could
therefore be assigned to a different quota day than the memo surface and
scheduler. This made billing telemetry misleading before enforcement is enabled.

## Decision

Resolve the current operator's timezone from `user_profiles` and count generated
briefings between that local calendar day's exact UTC boundaries. Derive the
boundaries from calendar-day transitions rather than a fixed UTC offset, so
23-hour and 25-hour daylight-saving days remain correct. If the profile lookup
fails, retain the existing fail-open posture, warn, and use UTC.

## Consequences

- Briefing quota observations now agree with the Daily Memo's local-day trust
  contract and scheduling semantics.
- DST transitions are covered without a new date/time dependency.
- The guard adds one small indexed profile lookup per generation attempt.
- This remains observe-only; changing it to enforcement is a separate billing
  decision and is not authorised by this ADR.

## Verification

Unit coverage pins Amsterdam's normal and DST boundaries, the query window used
by the briefing guard, and its explicit UTC fallback on profile read failure.
