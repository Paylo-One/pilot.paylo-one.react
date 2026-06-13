# Mobile Product Scope

## Role

Management OS Mobile is a companion command application for high-frequency,
time-sensitive interactions. It is not a smaller copy of the web admin product.

The mobile app should answer:

- What needs my attention now?
- What can I approve, dismiss, or defer quickly?
- What thought or observation do I need to capture before it disappears?
- Are my important sources healthy?

Configuration-heavy work, source onboarding, audit review, provider management,
and deep analysis remain web-first.

## MVP Screens

### Today

Displays the current briefing, its summary, and ranked priority signals.

### Briefing Detail

Shows one signal, why it matters, provenance, and quick decisions:

- Approve
- Dismiss
- Snooze
- More like this
- Less like this
- Mark important

### Actions

Shows suggested/open actions and allows approve, defer, or dismiss decisions.
It does not execute external side effects.

### Diary Capture

Captures a private text note. Voice permission and package boundaries are
prepared, but recording/upload is disabled until privacy and backend contracts
exist.

### Sources

Shows basic connection health and sync recency. Source setup remains on web.

### Settings

Shows session, environment, notification readiness, and future tenant selection.

## Non-Goals

- Rebuilding the full web workspace on mobile
- Embedding the Next.js app in a WebView
- Sharing complex React components across DOM and React Native
- Source/provider administration
- Billing, audit, prompt, model, or MCP administration
- Autonomous execution of suggested actions
- Pretending missing mobile endpoints or authentication already exist

## Parity Strategy

Parity means the two frontends agree on:

- Domain language and statuses
- Validation and API contracts
- Tenant and session semantics
- Ranking/feedback vocabulary
- Feature availability
- Design intent and semantic colors

Parity does not require identical layouts or interaction patterns. Web remains
information-dense; mobile remains focused, touch-friendly, and interruptible.

## Future Capabilities

- Push delivery for ready briefings and urgent signals
- Voice-note recording, encrypted upload, and transcription
- Offline capture queue with explicit sync state
- Tenant switching
- Biometric session protection
- Rich notification actions
- Mobile deep links from email and provider alerts
- Background refresh where platform policy permits it
