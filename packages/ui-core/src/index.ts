import type {
  BriefingItemPriority,
  BriefingItemStatus,
} from "@management-os/domain";

export type IconName =
  | "home"
  | "briefing"
  | "actions"
  | "diary"
  | "sources"
  | "settings";

export const emptyStateCopy = {
  briefing: "No briefing items are ready yet.",
  actions: "No open actions.",
  sources: "Connected source status will appear here.",
} as const;

export const priorityLabels: Record<BriefingItemPriority, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
  low: "Low",
};

export const statusLabels: Record<BriefingItemStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  dismissed: "Dismissed",
  snoozed: "Snoozed",
};

export function formatBriefingDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
