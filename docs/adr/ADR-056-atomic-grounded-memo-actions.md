# ADR-056: Create grounded memo actions at the database owner

Date: 2026-08-31  
Status: Accepted

## Context

An action created from a Daily Memo must retain the section's evidence without permitting partial creation, cross-tenant association, or duplicate effects after a lost response.

## Decision drivers

Tenant isolation, atomic consistency, retry safety, inspectable provenance, backward compatibility, and minimal operational complexity.

## Options considered

1. Copy in the Next.js server action. Simple, but two writes can partially fail and cannot meet FR-4.
2. Create and copy in a Postgres function with a per-attempt idempotency key. It adds a narrowly granted database contract but keeps the transaction with the state owner and handles retries.
3. Introduce an asynchronous worker. Retryable, but evidence would be temporarily absent and a queue adds unjustified operational complexity.

## Decision

Use option 2. The authenticated function derives the user from `auth.uid()`, validates tenant membership and all referenced tenant state, bounds the untrusted JSON payload, and atomically creates the action and copies existing references. A nullable client-generated UUID and partial unique index make one confirmation attempt single-effect without forbidding multiple intentional actions from one section.

## Consequences and revisit trigger

The function is a security-critical interface and must retain live RLS/abuse tests. Old code remains compatible with nullable columns. Audit logging remains best-effort and outside the authoritative transaction. Revisit if action creation moves away from Postgres, if multiple writers need a public versioned API, or if observed database contention makes the unique-key path material.
