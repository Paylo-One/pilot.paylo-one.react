/**
 * modules/refinement/refinement.types.ts
 *
 * User-guided refinement loop. Paylo.one becomes more useful as the operator
 * corrects, links, dismisses, confirms, and refines what it supplies. "Learning"
 * here means EXPLICIT, inspectable, tenant-scoped rules and preferences — never
 * hidden model fine-tuning (architecture/information-refinement-loop.md).
 *
 * Pure types + label maps (no persistence, no server-only).
 */

import type { SourceSystem } from "@/modules/shared";

/** The kind of feedback the operator gave. */
export type FeedbackType =
  | "not_relevant"
  | "always_include"
  | "link_person"
  | "wrong_person"
  | "lower_priority"
  | "raise_priority"
  | "treat_as_action"
  | "do_not_show_again"
  | "link_topic"
  | "confirm";

/** A one-off feedback event captured from a UI affordance. */
export interface UserFeedbackEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly feedbackType: FeedbackType;
  /** What the feedback was about (a source item, action, person, etc.). */
  readonly targetType: "source_item" | "action" | "person" | "memo_section" | "chat";
  readonly targetId: string;
  readonly note?: string | null;
  readonly createdAt: string;
}

/** What a refinement rule applies to. */
export type RuleScopeType =
  | "person"
  | "source"
  | "chat"
  | "domain"
  | "topic"
  | "project"
  | "global";

/** The kinds of standing rule the operator can set. */
export type RuleType =
  | "include_in_memo"
  | "exclude_from_memo"
  | "priority"
  | "person_link"
  | "topic_link"
  | "summarise_when_action"
  | "ignore_casual";

/** Lifecycle of a rule. */
export type RuleStatus = "active" | "paused";

/**
 * A standing, tenant-scoped refinement rule. Deterministic and inspectable: the
 * operator can read, edit, pause, or delete it. Rules are applied by the
 * correlation/triage/memo layers; conflicts resolve by `priority` then recency.
 */
export interface RefinementRule {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly ruleType: RuleType;
  readonly scopeType: RuleScopeType;
  /** Id of the scoped entity (person id, source system, chat id, domain…). */
  readonly scopeId: string;
  /** Human-readable scope label for display. */
  readonly scopeLabel: string;
  /** Optional condition (e.g. "mentions invoices", "action implied"). */
  readonly condition?: string | null;
  /** Human-readable statement of the rule. */
  readonly statement: string;
  /** Higher wins on conflict. */
  readonly priority: number;
  readonly status: RuleStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Per-person/source triage preference (a denormalised view of common rules). */
export interface TriagePreference {
  readonly id: string;
  readonly tenantId: string;
  readonly scopeType: RuleScopeType;
  readonly scopeId: string;
  readonly scopeLabel: string;
  readonly importance: "critical" | "high" | "normal" | "low" | "muted";
  readonly summariseOnlyWhenAction: boolean;
}

/** Daily Memo inclusion/exclusion preference for a source/person/chat. */
export interface MemoPreference {
  readonly id: string;
  readonly tenantId: string;
  readonly scopeType: RuleScopeType;
  readonly scopeId: string;
  readonly scopeLabel: string;
  readonly includeInMemo: boolean;
}

/** Feedback on a specific person-correlation decision (correct/incorrect link). */
export interface CorrelationFeedback {
  readonly id: string;
  readonly tenantId: string;
  readonly sourceItemId: string;
  readonly proposedPersonId: string | null;
  readonly correctedPersonId: string | null;
  readonly verdict: "correct" | "wrong" | "new_person";
  readonly createdAt: string;
}

// --- Label / affordance maps ------------------------------------------------

/** UI affordances grouped for the RefinementActions control. */
export const FEEDBACK_LABELS: Record<FeedbackType, string> = {
  not_relevant: "Not relevant",
  always_include: "Always include",
  link_person: "Link to person",
  wrong_person: "Wrong person",
  lower_priority: "Lower priority",
  raise_priority: "Raise priority",
  treat_as_action: "Treat as action",
  do_not_show_again: "Do not show again",
  link_topic: "Link to project / topic",
  confirm: "Confirm",
};

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  include_in_memo: "Include in daily briefing",
  exclude_from_memo: "Exclude from daily briefing",
  priority: "Priority",
  person_link: "Person link",
  topic_link: "Topic / project link",
  summarise_when_action: "Summarise only when action implied",
  ignore_casual: "Ignore casual messages",
};

export const SCOPE_TYPE_LABELS: Record<RuleScopeType, string> = {
  person: "Person",
  source: "Source",
  chat: "Chat",
  domain: "Domain",
  topic: "Topic",
  project: "Project",
  global: "Global",
};

/** A source-or-context the helper resolves for a refinement rule. */
export type RefinementSourceSystem = SourceSystem;
