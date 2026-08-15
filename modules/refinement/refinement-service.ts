/**
 * modules/refinement/refinement-service.ts
 *
 * Typed mock data + pure helpers for the refinement loop. Feedback-event
 * persistence lives in actions.ts; standing-rule application is not wired.
 *
 * Capturing feedback does not mutate model or rule state.
 */

import type { RefinementRule, FeedbackType } from "./refinement.types";

/** Illustrative standing rules a tenant might accumulate. */
export const MOCK_REFINEMENT_RULES: readonly RefinementRule[] = [
  {
    id: "rule_1",
    tenantId: "tenant_demo",
    userId: "user_demo",
    ruleType: "priority",
    scopeType: "person",
    scopeId: "person_robin",
    scopeLabel: "Robin Calloway",
    statement: "Always treat Robin Calloway as high priority.",
    priority: 80,
    status: "active",
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
  },
  {
    id: "rule_2",
    tenantId: "tenant_demo",
    userId: "user_demo",
    ruleType: "ignore_casual",
    scopeType: "chat",
    scopeId: "chat_family",
    scopeLabel: "Family group (WhatsApp)",
    condition: "casual / non-work",
    statement: "Ignore casual WhatsApp messages from this chat.",
    priority: 50,
    status: "active",
    createdAt: "2026-06-02T09:00:00.000Z",
    updatedAt: "2026-06-02T09:00:00.000Z",
  },
  {
    id: "rule_3",
    tenantId: "tenant_demo",
    userId: "user_demo",
    ruleType: "topic_link",
    scopeType: "person",
    scopeId: "person_alex",
    scopeLabel: "Alex Verhoeven",
    statement: "Link Alex Verhoeven's messages to the Payments migration project.",
    priority: 60,
    status: "active",
    createdAt: "2026-06-03T09:00:00.000Z",
    updatedAt: "2026-06-03T09:00:00.000Z",
  },
  {
    id: "rule_4",
    tenantId: "tenant_demo",
    userId: "user_demo",
    ruleType: "exclude_from_memo",
    scopeType: "domain",
    scopeId: "newsletters.example.com",
    condition: "unless it mentions invoices",
    scopeLabel: "newsletters.example.com",
    statement: "Treat emails from this domain as low priority unless they mention invoices.",
    priority: 40,
    status: "active",
    createdAt: "2026-06-04T09:00:00.000Z",
    updatedAt: "2026-06-04T09:00:00.000Z",
  },
];

/**
 * Map a one-tap feedback type to the standing rule it would propose. Pure +
 * illustrative: in MVP this drives a "create this rule?" confirmation rather
 * than silently mutating behaviour.
 */
export function proposedRuleForFeedback(
  feedback: FeedbackType,
): { ruleType: RefinementRule["ruleType"]; statement: string } | null {
  switch (feedback) {
    case "always_include":
      return { ruleType: "include_in_memo", statement: "Always include this in the daily briefing." };
    case "not_relevant":
    case "do_not_show_again":
      return { ruleType: "exclude_from_memo", statement: "Exclude this from the daily briefing." };
    case "raise_priority":
      return { ruleType: "priority", statement: "Raise the priority of this person/source." };
    case "lower_priority":
      return { ruleType: "priority", statement: "Lower the priority of this person/source." };
    case "link_topic":
      return { ruleType: "topic_link", statement: "Link this to a project/topic." };
    default:
      return null;
  }
}
