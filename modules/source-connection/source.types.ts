/**
 * modules/source-connection/source.types.ts
 *
 * The richer, presentation-facing types for the Connected Sources experience:
 * the categories, statuses, scope, and per-source GitHub monitoring model used
 * by the Sources screen. These are pure types + label maps (no persistence, no
 * server-only) so both server and client components can import them.
 *
 * Governance: architecture/source-integration-strategy.md (the canonical model),
 * services/source-connection.md, integration-architecture.md.
 *
 * Scaffold note: no source here is wired to a live provider. Activation,
 * scoping, and monitoring toggles operate on typed mock data to demonstrate the
 * intended control surface — never blind, account-wide ingestion.
 */

import type { SourceSystem, StoragePolicy } from "@/modules/shared";
import type { WhatsAppMonitor, WhatsAppSession } from "./whatsapp.types";

/**
 * The catalogue identifier for a connectable source. Aligned 1:1 with the
 * domain `SourceSystem` so there is a single source of truth: `email` is the
 * generic email category, `ms365_mail` the specific Microsoft 365 connector.
 */
export type SourceType = SourceSystem;

/** Where a source sits in the operator's mental model (drives the filter tabs). */
export type SourceCategory =
  | "communication"
  | "calendar"
  | "knowledge"
  | "engineering"
  | "files"
  | "productivity"
  | "enterprise";

/**
 * Operator-facing lifecycle status for a source. Distinct from the narrower
 * persisted `SourceConnectionStatus` (connected/disconnected/error): this is the
 * status shown on the card, derived from the connection plus the catalogue.
 */
export type SourceStatus =
  | "available" // designed + connectable, not yet connected
  | "connected" // authorised, not yet contributing to the memo
  | "active" // authorised, scoped, and feeding the Daily Memo
  | "paused" // authorised but the operator has paused ingestion
  | "needs_attention" // setup incomplete (e.g. scope/policy not chosen)
  | "error" // sync/auth failure the operator must act on
  | "coming_soon" // designed, connection not available in this build
  | "enterprise"; // requires enterprise/admin consent

/** Storage policy, surfaced per source (alias of the domain `StoragePolicy`). */
export type SourceStoragePolicy = StoragePolicy;

/** Whether derived insights from this source may carry source references. */
export type SourceReferencePolicy = "enabled" | "disabled";

/**
 * A human-readable description of the *currently selected* scope for a source,
 * plus whether the operator can narrow it further. The concrete scope shape is
 * source-specific (e.g. GitHub repositories, mail folders) — this is the
 * summary the card shows. See source-integration-strategy.md §5.
 */
export interface SourceScope {
  /** One-line summary, e.g. "3 repositories" or "Inbox + Flagged". */
  readonly summary: string;
  /** Whether scope can be narrowed before/after activation. */
  readonly configurable: boolean;
}

/** MVP confidence / phasing for a source (mirrors integration-architecture.md). */
export type SourceMvpStatus = "core" | "fast_follow" | "phased" | "enterprise";

/**
 * The designed catalogue entry for one source — the static description that the
 * Sources screen merges with live connection state to produce a card.
 */
export interface SourceDescriptor {
  readonly system: SourceType;
  readonly category: SourceCategory;
  /** Short mono glyph for the card. */
  readonly glyph: string;
  /** "Email · Gmail" style provider hint. */
  readonly provider: string;
  readonly description: string;
  readonly mvpStatus: SourceMvpStatus;
  /** Auth/consent model, summarised for the operator. */
  readonly authModel: string;
  /** What the connector pulls once scoped. */
  readonly dataPulled: string;
  /** How the operator controls scope (the heart of the product principle). */
  readonly scopeControl: string;
  /** How the source contributes to the Daily Memo. */
  readonly dailyMemoUse: string;
  /** Conservative default storage policy shown before connection. */
  readonly defaultPolicy: SourceStoragePolicy;
  /** Whether the source produces source-referenceable items by design. */
  readonly referenceReady: boolean;
  /** The connection affordance available in *this* build. */
  readonly connect: SourceConnectAffordance;
  /** Primary risk the operator should understand (kept short). */
  readonly riskNote: string;
}

/**
 * A fully-resolved, serialisable view of one source for the Connected Sources
 * screen — the catalogue descriptor merged with live connection state and
 * derived status. Built server-side and handed to the client browser (so it
 * carries no functions and no server-only data).
 */
export interface SourceView {
  readonly system: SourceType;
  readonly name: string;
  readonly provider: string;
  readonly glyph: string;
  readonly description: string;
  readonly category: SourceCategory;
  readonly status: SourceStatus;
  readonly mvpStatus: SourceMvpStatus;
  readonly storagePolicy: SourceStoragePolicy;
  readonly authModel: string;
  readonly dataPulled: string;
  readonly scopeControl: string;
  readonly dailyMemoUse: string;
  readonly riskNote: string;
  /** Pre-formatted last-sync label, or null when never synced. */
  readonly lastSync: string | null;
  readonly referenceReady: boolean;
  readonly inDailyMemo: boolean;
  readonly connect: SourceConnectAffordance;
  readonly connectionId: string | null;
  /** GitHub only: whether OAuth credentials are configured in this build. */
  readonly githubConfigured: boolean;
  /**
   * GitHub only: the operator's repository monitors (empty unless connected).
   * Real, persisted data — drives the repository selector.
   */
  readonly githubRepositories: readonly GitHubRepositoryMonitor[];
  /**
   * Notion only: the operator's shared resources (empty unless connected).
   * Real, persisted data — drives the resource selector.
   */
  readonly notionResources: readonly NotionResource[];
  /**
   * Google (email/calendar) and Microsoft 365 (ms365_mail/teams): selectable
   * scope items — Gmail labels, calendars, mail folders, or Teams chats and
   * channels (empty unless connected). Drives the scope selector.
   */
  readonly scopeItems: readonly SourceScopeItem[];
  /** Whether Google OAuth credentials are configured in this build. */
  readonly googleConfigured: boolean;
  /** Whether Microsoft Entra OAuth credentials are configured in this build. */
  readonly microsoftConfigured: boolean;
  /** WhatsApp only: the tenant's session (null until started). */
  readonly whatsappSession: WhatsAppSession | null;
  /** WhatsApp only: the operator's approved monitors (empty unless any). */
  readonly whatsappMonitors: readonly WhatsAppMonitor[];
  /**
   * WhatsApp only: whether the real Web-session bridge is wired in (ADR-036).
   * Drives real QR/discovery when true; the scaffold (simulate scan, mock
   * chats) when false.
   */
  readonly whatsappBridgeEnabled: boolean;
}

/** How (and whether) a source can actually be connected in this build. */
export type SourceConnectAffordance =
  | "github_oauth" // real GitHub OAuth (when configured)
  | "google_oauth" // real Google OAuth — Gmail + Calendar (when configured)
  | "microsoft_oauth" // real Microsoft Entra OAuth — MS 365 Mail / Teams (when configured)
  | "notion_token" // real Notion internal-integration token (paste → store)
  | "whatsapp_session" // tenant-scoped WhatsApp session (QR onboarding, scaffold)
  | "file_upload" // real in-app upload
  | "obsidian_upload" // real Markdown vault upload (Configure → upload form)
  | "scaffold" // designed, connection not wired
  | "phased" // designed, deliberately deferred
  | "enterprise"; // requires enterprise/admin consent

// --- GitHub repository-level monitoring ------------------------------------

/**
 * Per-repository monitoring switches. The product principle in practice: the
 * operator chooses *which signals* matter per repository, not "everything".
 * `discussions`, `workflows`, and `securityAlerts` are gated on availability /
 * granted permissions (source-integration-strategy.md §7).
 */
export interface GitHubMonitorSettings {
  readonly pullRequests: boolean;
  readonly issues: boolean;
  readonly commits: boolean;
  readonly releases: boolean;
  /** Available only where the repo/org enables Discussions. */
  readonly discussions: boolean;
  /** Workflow runs / CI status — where Actions is enabled. */
  readonly workflows: boolean;
  /** Security alerts — only where permissions allow. */
  readonly securityAlerts: boolean;
  /** Repository metadata (topics, language, visibility, default branch). */
  readonly metadata: boolean;
  /** README / docs context where appropriate. */
  readonly readmeDocs: boolean;
}

/** Visibility of a repository, as reported by GitHub. */
export type GitHubRepoVisibility = "public" | "private" | "internal";

/**
 * A repository the operator may choose to monitor. `isActive` is the explicit
 * approval gate: only active repositories ever inform the Daily Memo. Mirrors
 * the `github_repository_monitors` data object in the strategy doc (§7).
 */
export interface GitHubRepositoryMonitor {
  readonly id: string;
  /** "owner/name". */
  readonly fullName: string;
  readonly name: string;
  readonly description: string | null;
  readonly visibility: GitHubRepoVisibility;
  /** Whether this repository is approved for monitoring. */
  readonly isActive: boolean;
  /** Whether this repository's activity may inform the Daily Memo. */
  readonly includeInDailyMemo: boolean;
  /** ISO timestamp of the last sync, or null if never synced. */
  readonly lastSyncAt: string | null;
  readonly monitors: GitHubMonitorSettings;
}

/** A connected GitHub account/organisation the operator can select repos from. */
export interface GitHubAccount {
  readonly id: string;
  readonly login: string;
  readonly displayName: string;
  readonly kind: "user" | "organization";
}

// --- Generic per-source scope items (labels, folders, calendars, chats) ------

export type ScopeItemType =
  | "gmail_label"
  | "google_calendar"
  | "ms365_folder"
  | "ms365_calendar"
  | "teams_chat"
  | "teams_channel";

/**
 * A selectable scope item for a source — a Gmail label, Google/MS 365 calendar,
 * MS 365 mail folder, or Teams chat/channel. `isActive` is the approval gate;
 * only active items are synced. Mirrors the `source_scope_items` table.
 */
export interface SourceScopeItem {
  readonly id: string;
  readonly system: SourceType;
  readonly itemType: ScopeItemType;
  readonly externalId: string;
  readonly name: string | null;
  readonly isActive: boolean;
  readonly lastSyncAt: string | null;
}

// --- Notion resource selection ----------------------------------------------

export type NotionObjectType = "page" | "database";

/**
 * A Notion page/database the operator shared with their integration. `isActive`
 * is the approval gate — only active resources are synced into the Daily Memo.
 * Mirrors the `notion_resources` table.
 */
export interface NotionResource {
  readonly id: string;
  readonly notionId: string;
  readonly objectType: NotionObjectType;
  readonly title: string | null;
  readonly url: string | null;
  readonly isActive: boolean;
  readonly lastSyncAt: string | null;
}

// --- Label maps -------------------------------------------------------------

export const SOURCE_CATEGORY_LABELS: Record<SourceCategory, string> = {
  communication: "Communication",
  calendar: "Calendar",
  knowledge: "Knowledge",
  engineering: "Engineering",
  files: "Files",
  productivity: "Productivity",
  enterprise: "Enterprise",
};

export const SOURCE_STATUS_LABELS: Record<SourceStatus, string> = {
  available: "Available",
  connected: "Connected",
  active: "Active",
  paused: "Paused",
  needs_attention: "Needs attention",
  error: "Error",
  coming_soon: "Coming soon",
  enterprise: "Enterprise",
};

/** Maps a source status to the design system's muted status vocabulary. */
export const SOURCE_STATUS_TONE: Record<
  SourceStatus,
  "ok" | "info" | "warn" | "risk" | "neutral"
> = {
  available: "neutral",
  connected: "info",
  active: "ok",
  paused: "warn",
  needs_attention: "warn",
  error: "risk",
  coming_soon: "neutral",
  enterprise: "info",
};

export const STORAGE_POLICY_LABELS: Record<SourceStoragePolicy, string> = {
  raw_and_summaries: "Raw + summaries",
  summaries_only: "Summaries only",
  no_raw: "No raw",
  disabled: "Disabled",
};

/** Short rationale shown alongside each storage policy in the selector. */
export const STORAGE_POLICY_HINTS: Record<SourceStoragePolicy, string> = {
  raw_and_summaries:
    "Keep original items and generated summaries. Best retrieval, largest footprint.",
  summaries_only:
    "Keep summaries only; discard raw after processing. The conservative default.",
  no_raw: "Process in memory; persist neither raw items nor summaries.",
  disabled: "Do not ingest from this source at all.",
};

export const MVP_STATUS_LABELS: Record<SourceMvpStatus, string> = {
  core: "Dependable core",
  fast_follow: "Fast follow",
  phased: "Phased",
  enterprise: "Enterprise",
};

/** The repository monitoring options, in display order, with copy. */
export const GITHUB_MONITOR_OPTIONS: ReadonlyArray<{
  readonly key: keyof GitHubMonitorSettings;
  readonly label: string;
  readonly hint: string;
  /** Availability-gated options carry a caveat. */
  readonly conditional?: string;
}> = [
  { key: "pullRequests", label: "Pull requests", hint: "Opened, reviewed, merged" },
  { key: "issues", label: "Issues", hint: "Opened, assigned, closed" },
  { key: "commits", label: "Commits", hint: "Default-branch activity" },
  { key: "releases", label: "Releases", hint: "Tags and published releases" },
  {
    key: "discussions",
    label: "Discussions",
    hint: "Where Discussions is enabled",
    conditional: "if available",
  },
  {
    key: "workflows",
    label: "Workflow runs / CI",
    hint: "Actions runs and status",
    conditional: "if available",
  },
  {
    key: "securityAlerts",
    label: "Security alerts",
    hint: "Dependabot / code scanning",
    conditional: "permissions permitting",
  },
  { key: "metadata", label: "Repository metadata", hint: "Topics, language, branch" },
  { key: "readmeDocs", label: "README / docs", hint: "Context where appropriate" },
];
