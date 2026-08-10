# Changelog

All notable changes to Pilot are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Prepared the repository for open-source release: new README, community files, AGPL-3.0 licence, self-hosting guide, fictional demo fixtures, and removal of internal tooling and identifiers. No product behaviour changes.

## How releases work

- Tags are `vX.Y.Z` on `main`; GitHub Releases carry generated notes plus curated highlights.
- Pre-1.0, minor versions may include breaking changes — each release notes its upgrade path, including database migrations (`npx supabase db reset` on a fresh install; `supabase migration up` against an existing database).
- Until the first tagged release, this file tracks `main` under **Unreleased**.
