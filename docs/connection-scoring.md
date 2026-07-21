# Connection scoring — how Pilot decides two people are related

_Last updated: 2026-07-21. Scoring version `2026-07-21.v1`._

## The principle

A visible connection between two people is **never** created from an embedding
similarity score alone. It is a weighted combination of observable evidence,
each piece of which can be shown to the operator in plain language. Pilot
proposes; the operator confirms or dismisses — decisions are never overwritten.

## Where things live

| Concern | Module |
| --- | --- |
| Weights, thresholds, tiers (all constants, documented) | `modules/people/connection-scoring.ts` |
| Evidence extraction from source items (pure) | `modules/people/connection-evidence.ts` |
| Tenant pipeline: gather → score → write `entity_links` | `modules/people/person-connections.ts` |
| Embedding/index layer + non-person semantic suggestions | `modules/semantic-linking/service.ts` |
| Review-queue read (tiered, capped, labelled) | `modules/people/relationships.ts` (`listConnectionSuggestions`) |
| UI | `components/people/connection-suggestions.tsx`, `relationship-list.tsx` |

## Evidence kinds and weights

`score = Σ weight(kind) × strength(kind)`, clamped to [0, 0.99].

| Kind | Weight | Strength |
| --- | --- | --- |
| `direct_interaction` — A wrote a message/email in which B appears | 0.40 | diminishing returns: `n/(n+6)` |
| `co_occurrence` — both appear in an item authored by someone else | 0.25 | `n/(n+8)` |
| `shared_company` — same resolved company or identical organisation | 0.20 | boolean |
| `explicit` — the operator recorded the relationship | 0.10 | boolean; floors the tier at Relevant |
| `semantic_profile` — profile-embedding similarity | 0.05 | `(sim − 0.86) / 0.14`; zero below 0.86 |

Counts are **recency-decayed** first: each event contributes
`2^(−ageDays / 45)` (45-day half-life), so stale interaction fades instead of
accumulating forever.

## Noise controls

- **Duplicate ingestion counts once.** Items are deduplicated by content
  (title+body+author) before extraction; the same Teams message synced 116
  times is one piece of evidence.
- **Generic mentions can't match.** Only full display names (≥ 2 tokens,
  ≥ 5 chars) with word boundaries, emails, or verified handles match; "Em"
  never does.
- **Megadocuments are skipped.** An item mentioning more than 6 known people
  (all-hands notes, rosters) generates no pairs.
- **The operator is excluded.** The `is_self` person co-occurs with everyone;
  those pairs carry no information.
- **Semantic similarity is supporting-only.** With no hard evidence, a pair is
  capped at Possible — and with fewer than 2 events and no structural signal it
  stays hidden entirely.

## Tiers

| Tier | Score | Behaviour |
| --- | --- | --- |
| Strong | ≥ 0.45 | shown first, accent border |
| Relevant | ≥ 0.25 | shown by default |
| Possible | ≥ 0.12 | behind a "show possible connections" reveal |
| Hidden | < 0.12 | never surfaced; kept for recomputation |

## What gets stored

One `entity_links` row per person pair (canonical id order), with:

- `relationship_type` from the dominant evidence (`collaborates_with`,
  `frequent_correspondent`, `same_company`, `mentioned_with`);
- `confidence` = combined score; `evidence_summary` = plain-language headline;
- `evidence` (JSONB) = the individual signals `{kind, count, last_at, detail, sample}`;
- `evidence_count`, `score_version`, `computed_at` for observability.

Operator decisions are respected on recompute: **rejected pairs are skipped**
(they will not be re-suggested), **confirmed pairs only get their evidence
refreshed** — never their status or confidence.

## The semantic layer's role after this change

`knowledge_embeddings` remains a tenant-scoped retrieval index for all entity
types (distinct texts are embedded once). But semantic *suggestions* are
restricted to explainable cross-type pairs (person↔company, person/company/
diary↔action, action↔action at a stricter 0.90 bar; 0.85 otherwise), and
message↔message (`source_item`↔`source_item`) pairs are never suggested —
that pair type produced 9k+ duplicate-content links on real tenants.
Person↔person semantic similarity feeds this scoring model as the weak
`semantic_profile` signal instead of creating edges directly.

## Recalculation

- On every intelligence batch (`lib/inngest.ts` → `refresh-person-connections`).
- On demand from **Run correlation** on `/people`.
- Idempotent; tenant-scoped on every query; ~180-day evidence window with the
  decay handling anything older.

## Changing the model

Edit the constants in `CONNECTION_SCORING`, bump `version`, and rely on
`score_version` on each row to find stale scores. Add a new evidence kind by
extending `ConnectionSignalKind`, its weight, and the extraction in
`connection-evidence.ts` — the tests in `connection-scoring.test.ts` and
`connection-evidence.test.ts` encode the invariants (semantic-only caps,
duplicate collapsing, recency decay, diminishing returns).
