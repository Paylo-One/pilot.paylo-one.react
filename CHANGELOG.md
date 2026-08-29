# Changelog

All notable changes to Pilot are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Paused workspace invitation issuance and replaced unusable acceptance controls with an honest recovery path until secure membership acceptance is complete.
- Saved Daily Memo relevance feedback can now be undone without deleting its audit history; the latest explicit operator correction determines the visible state.
- Daily Memo insights can now be carried into a prefilled, user-confirmed action without retyping their context; drafts are scoped to the originating workspace and operator, degrade safely when browser storage is unavailable, and retain their briefing origin for outcome measurement.
- Added a bounded, operator-scoped Settings view of recently saved refinement feedback so corrections are inspectable without implying hidden learning or standing rules.
- Daily Memos now remain readable when saved-feedback lookup fails, while correction controls clearly pause until their state can be verified.
- Daily Memo feedback now remains visibly saved after refresh for the operator who submitted it, preventing accidental duplicate corrections.
- Daily Memo sections now expose honest one-off relevance feedback. Controls acknowledge only durable capture, show a retryable error when saving fails, and no longer imply that unimplemented standing-rule changes were applied.
- Daily Memo citations now show the source occurrence time and confidence, with the stored evidence expandable in place for faster claim verification.
- Prepared the repository for open-source release: new README, community files, AGPL-3.0 licence, self-hosting guide, fictional demo fixtures, and removal of internal tooling and identifiers. No product behaviour changes.

## How releases work

- Tags are `vX.Y.Z` on `main`; GitHub Releases carry generated notes plus curated highlights.
- Pre-1.0, minor versions may include breaking changes — each release notes its upgrade path, including database migrations (`npx supabase db reset` on a fresh install; `supabase migration up` against an existing database).
- Until the first tagged release, this file tracks `main` under **Unreleased**.
