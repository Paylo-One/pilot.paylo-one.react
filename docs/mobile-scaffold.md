# Mobile Scaffold Architecture

## Overview

The Management OS now has one product foundation and two frontend runtimes:

- The existing Next.js web application remains at the repository root.
- The Expo React Native companion application lives in `apps/mobile`.
- Framework-neutral contracts and services live in `packages`.

The web application was not moved to `apps/web`. Its current repository-relative
paths are part of Vercel, Supabase migration, and module import assumptions.
Moving it during the mobile scaffold would add deployment risk without improving
mobile code sharing. A future migration can move the web app after deployment
and CI paths have explicit workspace support.

## Repository Layout

```text
.
├── app/                         # Existing Next.js App Router application
├── components/                  # Existing web UI
├── modules/                     # Existing web/server modular monolith
├── apps/
│   └── mobile/                  # Expo SDK 56 + Expo Router
├── packages/
│   ├── api-client/
│   ├── auth/
│   ├── config/
│   ├── design-tokens/
│   ├── domain/
│   └── ui-core/
├── docs/
├── package.json                 # npm workspaces + root scripts
└── turbo.json
```

## Running The Apps

Install all workspaces:

```bash
npm install
```

Run web:

```bash
npm run dev:web
```

Run mobile:

```bash
cp apps/mobile/.env.example apps/mobile/.env.local
npm run dev:mobile
```

The Expo CLI can then open iOS, Android, or web. Push notifications require a
development build; Expo Go does not provide production push behavior.

Quality checks:

```bash
npm run lint
npm run typecheck
npm run build:web
npm run format:check
```

## Workspace Decisions

The repository already used npm and committed `package-lock.json`, so npm
workspaces were selected. Turborepo coordinates workspace lint/typecheck tasks.
The existing `dev`, `build`, and `start` web scripts are preserved.

Expo SDK 56 is used with the current `expo-audio` package. `expo-av` was not
introduced because its audio API is deprecated. Metro and Expo Autolinking have
first-class workspace support; no custom resolver is required for this layout.

## Shared Package Responsibilities

### `@management-os/domain`

Zod schemas and TypeScript models for tenants, users, briefings, briefing items,
feedback, actions, diary entries, connected sources, source types, and news
preferences.

### `@management-os/api-client`

Typed fetch client, response validation, tenant/auth headers, consistent
`ApiError`, query keys, and the initial mobile-facing API methods.

### `@management-os/auth`

Token/session models, storage interfaces, auth-header attachment, and a
platform-neutral session controller. It never reads browser `localStorage`.
Mobile implements the storage interface with Expo SecureStore.

### `@management-os/config`

Public environment normalization, platform identifiers, feature flags,
pagination defaults, and briefing defaults.

### `@management-os/design-tokens`

The core light/dark color language, spacing, radius, typography scale, and
elevation values extracted from `app/globals.css`. Web CSS remains intact.

### `@management-os/ui-core`

Only cross-platform-safe labels, icon-name types, formatting helpers, and empty
state copy. It contains no React components.

## Shared Versus Platform-Specific

Shared:

- Data contracts and validation
- API methods and query keys
- Session/token mechanics
- Feature flags and configuration
- Design values
- Formatting and status mappings

Platform-specific:

- Navigation and screens
- Cards, controls, forms, and layouts
- Web cookies/Supabase server session integration
- Mobile SecureStore and native permission flows
- Accessibility and interaction behavior

The mobile `BriefingCard.native.tsx` is intentionally independent from existing
web briefing UI. Both consume compatible domain concepts without a forced
cross-platform component abstraction.

## Environment Variables

Web:

```text
NEXT_PUBLIC_API_BASE_URL
```

An empty value keeps existing same-origin/server behavior intact.

Mobile:

```text
EXPO_PUBLIC_API_BASE_URL
```

This value is public in the app bundle. It must never contain credentials. A
physical device cannot use the host machine's `localhost`; use a reachable
development API URL.

## Authentication Boundary

The mobile provider can hydrate, replace, refresh, and clear a session through
the shared abstraction. The actual login flow remains intentionally unbuilt.
The next identity decision should choose how Expo obtains the same backend
session used by web:

- Supabase magic link or OAuth/OIDC via an app deep link
- Passkey support when the server flow is ready
- Refresh token rotation
- Tenant selection for multi-membership users

## Next Implementation Steps

1. Implement the mobile API endpoints in `docs/mobile-api-contracts.md`.
2. Connect mobile login to the selected Supabase/OIDC flow.
3. Add EAS project configuration and development builds.
4. Register push tokens only after authentication and notification policy exist.
5. Enable voice capture after upload, retention, and transcription contracts are
   approved.
6. Add contract tests that run the shared Zod schemas against real API fixtures.
