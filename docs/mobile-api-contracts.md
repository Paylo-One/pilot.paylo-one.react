# Mobile API Contracts

These endpoints are client contracts, not claims that backend routes already
exist. Implement them behind the existing tenant/session enforcement before
enabling a production API URL.

All requests:

- Send `Authorization: Bearer <token>` when token auth is selected.
- Send `X-Tenant-Id` when the session has an explicit tenant.
- Return JSON errors shaped as `{ "code": "...", "message": "..." }`.
- Enforce tenant membership server-side; never trust the header alone.

## Briefing

### `GET /api/v1/briefings/today`

Returns a `Briefing` with ordered `BriefingItem[]`.

### `GET /api/v1/briefing-items/{id}`

Returns one `BriefingItem` after tenant authorization.

### `PATCH /api/v1/briefing-items/{id}/status`

```json
{ "status": "approved | dismissed | snoozed" }
```

Returns the updated `BriefingItem`.

### `POST /api/v1/briefing-items/{id}/feedback`

```json
{
  "feedback": "more_like_this | less_like_this | important | not_relevant | hide_source | follow_topic | unfollow_topic"
}
```

Returns `{ "accepted": true }`.

## Actions

### `GET /api/v1/actions`

Returns `ActionItem[]`, newest or highest priority first.

### `PATCH /api/v1/actions/{id}/status`

```json
{ "status": "approved | deferred | dismissed | completed" }
```

Returns the updated `ActionItem`. Approval must not execute an external action
unless a separate governed execution flow is added.

## Diary

### `POST /api/v1/diary`

```json
{ "kind": "text", "body": "Private note" }
```

Returns the created author-scoped `DiaryEntry`.

Future voice entries should use a signed upload contract rather than embedding
audio in JSON.

## Connected Sources

### `GET /api/v1/connected-sources/status`

Returns a minimal `ConnectedSource[]` status projection. It must not include
provider credentials or configuration secrets.

## Compatibility

The shared client validates every successful response with Zod. Backend changes
that alter these shapes should update the shared schema and both frontends in
the same pull request.
