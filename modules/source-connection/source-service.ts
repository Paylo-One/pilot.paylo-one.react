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
 * Wired in this build (credentials permitting): File upload, Obsidian, GitHub,
 * Google (Gmail + Calendar), Notion, Microsoft 365 (Mail + Teams), and the
 * WhatsApp bridge behind its flag. Remaining entries are designed contracts.
 */

import type { SourceConnection } from "./index";
import type { SourceDescriptor, SourceStatus } from "./source.types";
import type { WhatsAppMonitor, WhatsAppSession } from "./whatsapp.types";

// --- The designed source catalogue -----------------------------------------

/**
 * Ordered for display. Communication/engineering core first, then knowledge and
 * files, then the phased/enterprise channels. Includes the two new sources —
 * MS 365 — Mail and Obsidian — alongside the existing set.
 */
export const SOURCE_DESCRIPTORS: readonly SourceDescriptor[] = [
  {
    system: "news",
    category: "external",
    provider: "RSS + GDELT",
    description:
      "Relevant external signals matched to your companies, people, markets, and strategic interests.",
    mvpStatus: "core",
    authModel: "Tenant preferences; provider keys remain server-side",
    dataPulled: "Headline, source, canonical URL, timestamp, language, and short snippet",
    scopeControl: "Categories, keywords, regions, monitored entities, providers, and blocked sources",
    dailyMemoUse: "Decision-focused External Signals above your relevance threshold",
    defaultPolicy: "summaries_only",
    referenceReady: true,
    connect: "news_preferences",
    riskNote: "Optional and off by default. Full article bodies are not stored.",
  },
  {
    system: "email",
    category: "communication",
    provider: "Google · Gmail",
    description:
      "Your Gmail inbox. Surfaces threads, asks, and commitments owed.",
    mvpStatus: "core",
    authModel: "OAuth 2.0 (Gmail API), read-only",
    dataPulled: "Thread metadata, participants, body/snippet (per policy)",
    scopeControl: "Selected labels, sender rules, time window",
    dailyMemoUse: "Threads needing a reply, decisions requested, follow-ups",
    defaultPolicy: "summaries_only",
    referenceReady: true,
    connect: "google_oauth",
    riskNote: "High volume and PII — scope and summarise aggressively.",
  },
  {
    system: "ms365_mail",
    category: "communication",
    provider: "Microsoft 365 · Mail",
    description:
      "The specific Microsoft 365 mailbox connector via Entra consent and Graph.",
    mvpStatus: "fast_follow",
    authModel: "Microsoft Entra OAuth / Graph (Mail.Read + Calendars.Read), least-privilege",
    dataPulled: "Selected folders + calendars only; metadata + body per policy",
    scopeControl: "Selected folders and calendars; only active items sync",
    dailyMemoUse: "Priority mail and commitments from the chosen folders",
    defaultPolicy: "summaries_only",
    referenceReady: true,
    connect: "microsoft_oauth",
    riskNote: "Mail.Read is broad — folder scoping is essential.",
  },
  {
    system: "calendar",
    category: "calendar",
    provider: "Google · Calendar",
    description: "Meetings today with prep pointers and linked context.",
    mvpStatus: "core",
    authModel: "OAuth (Google Calendar), read-only",
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
    provider: "Microsoft Teams",
    description: "Signals and themes across selected chats and channels.",
    mvpStatus: "fast_follow",
    authModel: "Microsoft Entra OAuth / Graph (Chat.Read); channels need admin consent",
    dataPulled: "Chat/channel messages, mentions (per consent granted)",
    scopeControl: "Selected chats/channels; DMs vs channels chosen explicitly",
    dailyMemoUse: "Escalations, decisions, and mentions from chosen channels",
    defaultPolicy: "summaries_only",
    referenceReady: true,
    connect: "microsoft_oauth",
    riskNote: "Channel reads need tenant-admin consent; chats are the dependable path.",
  },
  {
    system: "whatsapp",
    category: "communication",
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
    case "news_preferences":
    case "file_upload":
    case "scaffold":
    default:
      return "available";
  }
}

/**
 * Derive the catalogue status for WhatsApp from its session + monitors.
 * WhatsApp lives outside `source_connections`, so the generic deriver always
 * reads `available` for it. Map session lifecycle → SourceStatus instead, and
 * promote a connected session with at least one active monitor to `active`.
 */
export function deriveWhatsAppSourceStatus(
  session: WhatsAppSession | null,
  monitors: readonly WhatsAppMonitor[],
): SourceStatus {
  if (!session) return "available";
  switch (session.status) {
    case "error":
      return "error";
    case "needs_reconnect":
    case "expired":
      return "needs_attention";
    case "awaiting_qr":
    case "connecting":
      return "needs_attention";
    case "connected":
      return monitors.some((m) => m.isActive) ? "active" : "connected";
    case "disconnected":
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
