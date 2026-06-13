# News Briefing

Status: MVP implemented. Governed by ADR-039 and the longer architecture record
in `../governance/docs/architecture/news-briefing-architecture.md`.

## Product role

News is an optional Connected Source, not a default feed. It surfaces external
signals only when they match tenant categories, keywords, monitored companies
or people, regions, countries, publications, and a configurable relevance
threshold.

It is deliberately separate from internal source ingestion:

1. Providers fetch and normalise external metadata.
2. The News pipeline deduplicates, classifies, ranks, and stores candidates.
3. Daily Memo generation consumes ranked candidates only.
4. Provider code is never imported by the briefing generator.

## Implemented architecture

```text
RSS / GDELT adapters
  -> normalised News item
  -> URL + title/story deduplication
  -> heuristic category/entity/risk/sentiment classification
  -> tenant + recency + credibility + feedback ranking
  -> ranked candidate
  -> persisted "External Signals" Daily Memo section
  -> item/source/topic feedback
```

Provider failures are isolated per adaptor and stored on
`news_ingestion_run`. A partial or failed News fetch does not fail the main
Daily Memo.

## Providers

| Provider | Tier | State |
|---|---|---|
| RSS / Atom | Production | Implemented; tenant feed URLs plus curated defaults |
| GDELT 2.0 Doc API | Production | Implemented |
| Guardian Open Platform | Production | Registered, adaptor pending |
| NewsAPI.org | Development only | Registered, deliberately disabled |
| NewsData.io | Production/future | Registered, adaptor pending |

Tenant-supplied RSS URLs are restricted to public HTTP(S) hosts. Private,
loopback, `.local`, and `.internal` destinations are rejected to reduce SSRF
risk.

## Data model

- `news_provider`: platform provider catalogue.
- `news_source_config`: tenant provider enablement and RSS feed URLs.
- `news_tenant_preferences`: tenant scope, ranking, and briefing settings.
- `news_item`: normalised article metadata and dedupe fingerprints.
- `news_item_entity`: companies, people, topics, and places.
- `news_item_classification`: category, country, risk, urgency, sentiment,
  confidence, and topic tags.
- `news_briefing_item`: ranked candidate, inclusion reason, and shown state.
- `news_feedback`: item/source/topic feedback.
- `news_config_audit`: field-level configuration changes.
- `news_ingestion_run`: run counts, provider errors, status, and timestamps.

Every tenant-owned table has `tenant_id`, RLS, an authenticated read policy,
and service-role-only writes. `news_provider` has RLS with a global
authenticated read policy. News provenance is linked from `source_references`
through `news_item_id`.

## Connected Source UI

`/sources/news` supports:

- Enable/disable News.
- Enable/disable Daily Memo inclusion.
- Select all ten News categories.
- Configure keywords, companies, people, countries, regions, languages,
  preferred publications, and blocked publications.
- Configure maximum briefing items and minimum relevance.
- Enable/test provider adaptors and configure RSS feed URLs.
- Fetch immediately.
- View recent items, relevance, inclusion factors, latest run status, and
  configuration audit history.

Only workspace owners/admins may change configuration, test providers, or run
ingestion. Any tenant member may submit relevance feedback on an item.

## API

All tenant-facing endpoints require an authenticated tenant-host session:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/admin/news/providers` | Provider catalogue + tenant state |
| GET | `/api/admin/news/preferences` | Tenant preferences |
| PUT | `/api/admin/news/preferences` | Audited preference update |
| GET | `/api/admin/news/items?limit=30` | Recent fetched/ranked items |
| GET | `/api/admin/news/items/{id}` | Item, classification, entities, rank reason |
| POST | `/api/admin/news/preview` | Current eligible External Signals |
| POST | `/api/admin/news/feedback` | Record feedback and preference nudges |
| GET | `/api/admin/news/audit` | Configuration audit |
| POST | `/api/admin/news/sources/test` | Test an implemented adaptor |

Background/manual internal ingestion:

```http
POST /api/news/ingest
Authorization: Bearer $NEWS_INGESTION_TOKEN
Content-Type: application/json

{"tenantId":"optional-tenant-uuid"}
```

Omit `tenantId` to process all enabled tenants. The MVP processes tenants
sequentially. Production orchestration should fan out one durable job per tenant.

## Ranking and feedback

MVP ranking is deterministic. Factors include:

- selected category;
- configured keyword matches;
- monitored company/person mentions;
- source credibility;
- recency;
- bounded keyword overlap with recent source items and diary entries;
- prior source/topic feedback.

`hide_source` updates blocked sources and suppresses matching candidates.
`follow_topic` and `unfollow_topic` update keywords. More/less/important/not
relevant adjust the current item and feed bounded weights into future runs.

The stored `rank_reason` powers the admin "why included" view. Relevance scores
remain internal on the Daily Memo.

## Privacy and provider terms

The system stores title, canonical URL, source, timestamp, language, short
provider snippet, provider metadata, classifications, and ranking metadata. It
does not store full article bodies. Every signal links back to the original
publication. Development-tier providers are excluded from production
ingestion.

## Operations

- Set `NEWS_INGESTION_TOKEN` for the internal trigger.
- Schedule `POST /api/news/ingest` until Inngest is wired.
- Monitor `news_ingestion_run` for partial/failed runs and provider errors.
- Keep feed lists small and trusted; provider calls have a 12-second timeout.
- A provider outage should result in a partial run, never a failed core memo.

## Testing

Automated project checks:

```bash
npm run typecheck
npm run lint
npm run build
npx supabase db lint --local
npx supabase db advisors --local --type security
```

Manual acceptance:

1. Enable News for a tenant.
2. Select categories and add a distinctive keyword/company.
3. Enable RSS/GDELT and test each connection.
4. Fetch now and inspect stored/relevant counts.
5. Confirm recent items expose their inclusion factors.
6. Generate a Daily Memo and confirm External Signals appear only above the
   threshold.
7. Submit feedback and verify the item/source/topic behavior and audit rows.
8. Confirm another tenant cannot read any News rows.

## Remaining production decisions

- Wire durable scheduled fan-out with Inngest, retries, and concurrency limits.
- Add Guardian once commercial terms and key management are approved.
- Replace the bounded keyword overlap with richer project/entity correlation
  and add LLM enrichment through the Model Gateway, retaining heuristic fallback.
- Define retention windows for provider raw metadata and old News items.
- Add provider-specific rate-limit/backoff policies and operational alerts.
- Add automated fixture, integration, RLS, and end-to-end test suites.
