# ADR-055: Enforce feedback authorship in RLS

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

`user_feedback_events` records the operator whose correction may later shape Pilot. The existing insert policy checked tenant membership but allowed a direct authenticated PostgREST caller to supply another user's id.

Driving characteristics are trustworthy attribution, tenant isolation, and minimal operational complexity.

## Options

1. **Trust the server action only.** Simple for normal UI traffic, but the authenticated table grant remains another writable boundary and permits forged authorship.
2. **Require `user_id = auth.uid()` in the insert policy.** Enforces attribution at the state owner for server actions and direct PostgREST clients, with no new service or state.
3. **Remove authenticated table insert access and use a secret client.** Centralises writes but widens server privilege and bypasses RLS, increasing blast radius.

## Decision

Choose option 2. The database is the sole owner of the event and enforces both tenant membership and authenticated authorship. The application continues deriving both values server-side as defence in depth.

## Consequences

Clients may no longer create anonymous (`user_id = null`) feedback events. Existing rows and reads are unchanged. Older application code that already writes the signed-in user remains compatible. Rollback of the application is safe against the stricter policy.

## Revisit tripwire

Revisit if service-generated feedback events are introduced; give those events a distinct actor model rather than weakening the human-authorship policy.
