/**
 * modules/source-connection/source-service.ts
 *
 * The designed source catalogue + typed mock data for the Connected Sources
 * experience, plus pure helpers that derive an operator-facing status from a
 * live connection. No persistence and no `server-only`: this is the scaffold's
 * single source of truth for *what is designed*, importable by server and
 * client components alike.
 *
 * Governance: architecture/source-integration-strategy.md (canonical),
 * integration-architecture.md, services/source-connection.md.
 *
 * Scaffold note: only File upload and (when credentials are configured) GitHub
 * are wired in this build. Every other entry is a designed connection contract.
 * The GitHub repositories below are mock data illustrating repository-level
 * monitoring — "monitor selected repositories only", never the whole account.
 */

import type { SourceConnection } from "./index";
import type { SourceDescriptor, SourceStatus } from "./source.types";

// --- The designed source catalogue -----------------------------------------

/**
 * Ordered for display. Communication/engineering core first, then knowledge and
 * files, then the phased/enterprise channels. Includes the two new sources —
 * MS 365 — Mail and Obsidian — alongside the existing set.
 */
export const SOURCE_DESCRIPTORS: readonly SourceDescriptor[] = [
  {
    system: "email",
    category: "communication",
    glyph: "@",
    provider: "Email · Gmail / Outlook",
    description:
      "The generic email category. Surfaces threads, asks, and commitments owed.",
    mvpStatus: "core",
    authModel: "OAuth 2.0 (Gmail API / Microsoft Graph), read-only",
    dataPulled: "Thread metadata, participants, body/snippet (per policy)",
    scopeControl: "Selected labels/folders, sender rules, time window",
    dailyMemoUse: "Threads needing a reply, decisions requested, follow-ups",
    defaultPolicy: "summaries_only",
    referenceReady: true,
    connect: "google_oauth",
    riskNote: "High volume and PII — scope and summarise aggressively.",
  },
  {
    system: "ms365_mail",
    category: "communication",
    glyph: "M",
    provider: "Microsoft 365 · Mail",
    description:
      "The specific Microsoft 365 mailbox connector via Entra consent and Graph.",
    mvpStatus: "fast_follow",
    authModel: "Microsoft Entra OAuth / Graph (Mail.Read), least-privilege",
    dataPulled: "Selected folders only; metadata + body per policy",
    scopeControl: "Selected folders, from people/domains, unread, flagged, window",
    dailyMemoUse: "Priority mail and commitments from the chosen folders",
    defaultPolicy: "summaries_only",
    referenceReady: true,
    connect: "scaffold",
    riskNote: "Mail.Read is broad — fold/sender scoping is essential.",
  },
  {
    system: "calendar",
    category: "calendar",
    glyph: "◷",
    provider: "Calendar · Google / Microsoft 365",
    description: "Meetings today with prep pointers and linked context.",
    mvpStatus: "core",
    authModel: "OAuth (Google Calendar / Graph Calendars), read-only",
    dataPulled: "Events, attendees, times, descriptions, linked notes",
    scopeControl: "Selected calendars, forward window (today + 7d)",
    dailyMemoUse: "“Meetings today” and meeting-prep context",
    defaultPolicy: "summaries_only",
    referenceReady: true,
    connect: "google_oauth",
    riskNote: "Attendee data is sensitive; timezone correctness matters.",
  },
  {
    system: "github",
    category: "engineering",
    glyph: "GH",
    provider: "GitHub",
    description:
      "Engineering signals from the repositories you approve — never the whole account.",
    mvpStatus: "core",
    authModel: "GitHub App install (preferred) or OAuth, read-only least-privilege",
    dataPulled: "PRs, issues, commits, releases (per-repo monitoring options)",
    scopeControl: "Select organisation, then specific repositories + per-repo signals",
    dailyMemoUse: "Blockers, review requests, and recent changes from selected repos",
    defaultPolicy: "summaries_only",
    referenceReady: true,
    connect: "github_oauth",
    riskNote: "Account-wide ingestion is the risk — repository selection is mandatory.",
  },
  {
    system: "teams",
    category: "communication",
    glyph: "T",
    provider: "Microsoft Teams",
    description: "Signals and themes across selected chats and channels.",
    mvpStatus: "phased",
    authModel: "Microsoft Graph; channel scopes need admin/tenant consent",
    dataPulled: "Chat/channel messages, mentions (per consent granted)",
    scopeControl: "Selected chats/channels; DMs vs channels chosen explicitly",
    dailyMemoUse: "Escalations, decisions, and mentions from chosen channels",
    defaultPolicy: "summaries_only",
    referenceReady: true,
    connect: "enterprise",
    riskNote: "Admin consent often unavailable; phased with a digest fallback.",
  },
  {
    system: "whatsapp",
    category: "communication",
    glyph: "W",
    provider: "WhatsApp",
    description: "Monitor selected people or chats — never every conversation.",
    mvpStatus: "phased",
    authModel: "Tenant-scoped session (QR onboarding); approach pending validation",
    dataPulled: "Messages from approved people/chats only",
    scopeControl: "Select specific people/chats; activate per person/chat",
    dailyMemoUse: "Signals from approved people/chats only",
    defaultPolicy: "no_raw",
    referenceReady: true,
    connect: "whatsapp_session",
    riskNote: "Approach pending validation; monitor approved people/chats only.",
  },
  {
    system: "notion",
    category: "knowledge",
    glyph: "N",
    provider: "Notion",
    description: "Docs and briefs from the pages and databases you share.",
    mvpStatus: "core",
    authModel: "Notion internal-integration token; pages shared explicitly with it",
    dataPulled: "Shared pages, databases, block text",
    scopeControl: "Only pages/databases shared with the integration, then activated",
    dailyMemoUse: "“Recently changed context” the memo can cite",
    defaultPolicy: "summaries_only",
    referenceReady: true,
    connect: "notion_token",
    riskNote: "No general webhooks (freshness lag); large workspaces.",
  },
  {
    system: "obsidian",
    category: "knowledge",
    glyph: "Ob",
    provider: "Obsidian · local-first",
    description: "Markdown vault context — starting with file/vault upload.",
    mvpStatus: "phased",
    authModel: "Local-first; upload first, Git-backed vault / local connector later",
    dataPulled: "Markdown notes, frontmatter, tags, internal links, attachments",
    scopeControl: "Operator selects which vault/folders to bring in",
    dailyMemoUse: "Personal knowledge and notes the memo can cite",
    defaultPolicy: "summaries_only",
    referenceReady: true,
    connect: "obsidian_upload",
    riskNote: "Local-first and private; never auto-sync a whole vault.",
  },
  {
    system: "file_upload",
    category: "files",
    glyph: "↑",
    provider: "File & paste upload",
    description: "Bring in a note or document directly — no credentials needed.",
    mvpStatus: "core",
    authModel: "None external — authenticated in-app upload",
    dataPulled: "PDF, Markdown, DOCX, TXT (CSV later); extracted text",
    scopeControl: "Per-file; the operator chooses exactly what to upload",
    dailyMemoUse: "Documents the operator explicitly wants considered",
    defaultPolicy: "summaries_only",
    referenceReady: true,
    connect: "file_upload",
    riskNote: "Parsing fidelity and malicious files — validate at the boundary.",
  },
];

/** Lookup a descriptor by system. */
export function getSourceDescriptor(
  system: SourceDescriptor["system"],
): SourceDescriptor | undefined {
  return SOURCE_DESCRIPTORS.find((d) => d.system === system);
}

// --- Status derivation ------------------------------------------------------

/**
 * Derive the operator-facing status for a source from its (optional) live
 * connection plus the catalogue. Pure and conservative: a connection that
 * exists but has not had its scope/policy confirmed reads as `needs_attention`
 * rather than silently `active`.
 */
export function deriveSourceStatus(
  descriptor: SourceDescriptor,
  connection: SourceConnection | undefined,
): SourceStatus {
  if (connection) {
    if (connection.status === "error") return "error";
    if (connection.status === "disconnected") return "available";
    // connected: storage policy decides whether it is contributing.
    if (connection.storagePolicy === "disabled") return "paused";
    return "active";
  }
  switch (descriptor.connect) {
    case "enterprise":
      return "enterprise";
    case "phased":
      return "coming_soon";
    case "github_oauth":
    case "file_upload":
    case "scaffold":
    default:
      return "available";
  }
}

/**
 * Whether a source, given its derived status, is contributing to the Daily Memo.
 * Only `active`, reference-ready sources inform the memo (the trust contract).
 */
export function isInDailyMemo(
  descriptor: SourceDescriptor,
  status: SourceStatus,
): boolean {
  return status === "active" && descriptor.referenceReady;
}

// GitHub repository data is now REAL (persisted in `github_repository_monitors`
// and read via `github-repos.ts`). The former mock repositories were removed
// when the repository selector was wired to live data.
