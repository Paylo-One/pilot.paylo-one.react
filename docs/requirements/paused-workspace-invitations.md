# Requirements: Pause unusable workspace invitations

- **Status:** Agreed as a reversible safety correction
- **Date:** 2026-08-23
- **Author:** Pleco (automated product owner)
- **Work classification:** Substantial — the externally shared `/invite` route is a changed public interface across several components. No data is deleted and the decision is reversible.

## Problem and evidence

Operators can issue and copy invitation links, but recipients reach a placeholder that cannot validate a token or create membership. The product therefore claims an adoption workflow works when completion is impossible (issue #79, observed 2026-08-22).

The simplest complete outcome is to stop issuing links and make existing links explain the limitation and recovery path. Leaving creation enabled is rejected because it continues the trust defect. Implementing acceptance is not selected autonomously because it crosses unauthenticated-token, identity, service-role, and tenant-membership boundaries and would commit the product to multi-user workspaces before the recorded product direction is reconciled.

Applicable constitution sequence: engineering principles → requirements → architecture analysis (compressed: pause versus secure acceptance) → system design (compressed: presentation-only removal, no new state owner) → distributed/reliability analysis (compressed: no new remote interaction) → software design → lifecycle → adversarial review.

## Requirements and invariants

| ID | Requirement | Verification |
|---|---|---|
| FR-1 | Signed-in operators cannot copy or create a workspace invitation from navigation, Daily Memo, Settings, or Invitations. | Component tests/typecheck and repository search |
| FR-2 | An existing `/invite?token=…` link clearly says it cannot add the recipient and offers request-access and sign-in recovery paths. | Route test/component inspection |
| FR-3 | Settings and Invitations describe the capability as paused/planned, never available. | Component inspection |
| INV-1 | No membership, invitation, referral, authentication, or tenant state changes as a result of this slice. | Diff inspection |
| INV-2 | Existing invitation records and tokens are retained so a future approved flow can migrate or revoke them deliberately. | Migration/diff inspection |
| INV-3 | The interface does not imply that an unusable invitation can be accepted. | Copy inspection |

Quality targets: zero newly issued links through product UI; no additional network calls on affected pages; existing availability and accessibility conventions retained. Availability and scale are otherwise unchanged.

## Failure modes and scope

Direct or bookmarked `/invitations` visits show the paused state. Old shared invite links do not disclose token, tenant, inviter, or membership information and point to an existing access-request path. Database failures are irrelevant because these surfaces no longer read referral state.

Out of scope: deleting or revoking existing records; implementing invitation acceptance; changing registration policy; adding analytics; changing the referral schema or service. Product direction remains unresolved between invite-led growth, public registration, and later team/workspace support and requires Bernard's approval before acceptance work.

## Decision and rollback

Options considered: (1) keep the placeholder, rejected as deceptive; (2) implement full acceptance, deferred as security-critical and strategically unresolved; (3) pause issuance and provide recovery, selected as the smallest reversible trust repair. Rollback is a normal revert; no data migration or compatibility step is required.
