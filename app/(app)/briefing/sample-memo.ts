/**
 * app/(app)/briefing/sample-memo.ts
 *
 * A typed, illustrative Daily Memo used to demonstrate the full editorial
 * structure before a real briefing has been generated. It mirrors the eleven
 * sections defined in product/daily-memo.md and the source-reference trust
 * contract (every insight carries provenance) so the surface is built "as if
 * source references are real".
 *
 * This is clearly-labelled sample content in the UI. It is NOT persisted, NOT
 * tenant data, and is never presented as the operator's own briefing.
 */

export interface SampleReference {
  readonly system: string;
  readonly pointer: string;
  readonly timestamp: string;
  readonly confidence: number;
}

export type SampleSectionLayout = "summary" | "items";

export interface SampleItem {
  readonly title: string;
  readonly detail?: string;
  readonly status?: { label: string; tone: "info" | "ok" | "warn" | "risk" | "neutral" };
  readonly references: SampleReference[];
}

export interface SampleSection {
  readonly kind: string;
  readonly title: string;
  readonly layout: SampleSectionLayout;
  readonly summary?: string;
  readonly items?: SampleItem[];
  readonly focus?: boolean;
}

/** The eleven Daily Memo sections, in the canonical order. */
export const SAMPLE_MEMO: { readonly sections: SampleSection[] } = {
  sections: [
    {
      kind: "executive_summary",
      title: "Executive summary",
      layout: "summary",
      focus: true,
      summary:
        "Two decisions need your call before the 14:00 with Mara, and the single-vendor payments risk moved from medium to high overnight. Three follow-ups are ageing. Everything below is ranked by consequence and traceable to source.",
    },
    {
      kind: "critical_items",
      title: "Critical items",
      layout: "items",
      items: [
        {
          title: "Payments rail incident reduced redundancy to a single provider",
          detail: "If unaddressed today it becomes a board question this week.",
          status: { label: "High", tone: "risk" },
          references: [
            { system: "Email", pointer: "Thunes · incident notice", timestamp: "06:12", confidence: 0.91 },
            { system: "GitHub", pointer: "infra#482 · failover", timestamp: "05:40", confidence: 0.84 },
          ],
        },
      ],
    },
    {
      kind: "decisions_needed",
      title: "Decisions needed",
      layout: "items",
      items: [
        {
          title: "Approve dual-provider payments architecture",
          detail: "Mara needs a direction before scoping the migration.",
          status: { label: "Pending", tone: "info" },
          references: [
            { system: "Notion", pointer: "Payments resilience brief", timestamp: "Yesterday", confidence: 0.88 },
          ],
        },
        {
          title: "Confirm Q3 hiring freeze exception for the platform team",
          status: { label: "Pending", tone: "info" },
          references: [
            { system: "Email", pointer: "Priya · headcount", timestamp: "Yesterday", confidence: 0.79 },
          ],
        },
      ],
    },
    {
      kind: "suggested_actions",
      title: "Suggested actions",
      layout: "items",
      items: [
        {
          title: "Reply to Thunes with a holding position on failover",
          detail: "Prepared, not sent — review and approve in Actions.",
          status: { label: "Suggested", tone: "neutral" },
          references: [
            { system: "Email", pointer: "Thunes · incident notice", timestamp: "06:12", confidence: 0.9 },
          ],
        },
      ],
    },
    {
      kind: "follow_ups",
      title: "Follow-ups",
      layout: "items",
      items: [
        {
          title: "SOC 2 evidence request to Priya is 2 days overdue",
          status: { label: "Overdue", tone: "warn" },
          references: [
            { system: "Email", pointer: "Compliance thread", timestamp: "2d ago", confidence: 0.86 },
          ],
        },
      ],
    },
    {
      kind: "meetings_today",
      title: "Meetings today",
      layout: "items",
      items: [
        {
          title: "14:00 · Payments resilience with Mara",
          detail: "Prep: bring the dual-provider decision and the incident timeline.",
          references: [
            { system: "Calendar", pointer: "14:00 · Mara", timestamp: "Today", confidence: 0.98 },
          ],
        },
      ],
    },
    {
      kind: "signals",
      title: "Signals from communication channels",
      layout: "items",
      items: [
        {
          title: "Renewed customer concern about payout latency in three threads",
          detail: "Theme emerging across support and sales channels.",
          references: [
            { system: "Teams", pointer: "#customers", timestamp: "Last 24h", confidence: 0.71 },
          ],
        },
      ],
    },
    {
      kind: "risks_blockers",
      title: "Risks and blockers",
      layout: "items",
      items: [
        {
          title: "Single-vendor payments dependency",
          detail: "Escalated Medium → High after the overnight incident.",
          status: { label: "Escalated", tone: "risk" },
          references: [
            { system: "GitHub", pointer: "infra#482", timestamp: "05:40", confidence: 0.83 },
          ],
        },
      ],
    },
    {
      kind: "changed_context",
      title: "Recently changed context",
      layout: "items",
      items: [
        {
          title: "Payments resilience brief updated with provider options",
          status: { label: "Updated", tone: "info" },
          references: [
            { system: "Notion", pointer: "Payments resilience brief", timestamp: "Yesterday", confidence: 0.8 },
          ],
        },
      ],
    },
    {
      kind: "next_moves",
      title: "Recommended next moves",
      layout: "summary",
      summary:
        "If you do three things today: (1) settle the dual-provider decision, (2) send the holding reply to Thunes, (3) close out the SOC 2 evidence request to Priya.",
    },
    {
      kind: "source_references",
      title: "Source references",
      layout: "summary",
      summary:
        "This memo was assembled from Email, Calendar, GitHub, Notion, and Teams. Every claim above resolves to a specific item, timestamp, and confidence. Nothing is shown that cannot be attributed.",
    },
  ],
};
