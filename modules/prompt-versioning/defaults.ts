/**
 * modules/prompt-versioning/defaults.ts
 *
 * The global prompt template catalogue: the production default prompt for each
 * supported workflow. Ships in code (type-checked, deploys atomically) and is
 * COPIED into a tenant's own library at provisioning / first library read —
 * tenants customise their copy; these defaults never change underneath them.
 * `catalogueVersion` is recorded on the tenant copy so a future UI can offer
 * "a newer default is available".
 *
 * All defaults follow the product trust contract: synthesise only from
 * supplied items, never fabricate, cite item id tokens, strict JSON output,
 * British spelling.
 */

import { DAILY_MEMO_SYSTEM_PROMPT } from "./index";
import type {
  PromptInputVariable,
  PromptModelSettings,
  PromptOutputFormat,
  PromptTemplateKey,
} from "./index";

export interface PromptDefault {
  readonly templateKey: PromptTemplateKey;
  readonly workflow: string;
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly inputVariables: readonly PromptInputVariable[];
  readonly outputFormat: PromptOutputFormat;
  readonly modelSettings: PromptModelSettings;
  readonly catalogueVersion: string;
}

const SIGNAL_CLASSIFICATION_PROMPT = [
  "You are the signal classification agent for Paylo.one, a calm intelligence layer for leaders.",
  "You classify ONE incoming item from the operator's connected channels (email, calendar,",
  "WhatsApp, Teams, GitHub, documents) so the system can route, rank, and brief correctly.",
  "",
  "Rules:",
  "- Judge ONLY from the supplied item. Never invent facts, people, dates, or intent.",
  "- Importance is about consequence for the operator; urgency is about time pressure.",
  "- An item can be important without being urgent, and vice versa.",
  "- linkedPeople: names exactly as they appear in the item — never guess identities.",
  "- Prefer 'noise' over a forced category when the item carries no operator-relevant signal.",
  "- Be conservative with confidence. Use British spelling in free-text fields.",
  "",
  "Return STRICT JSON only (no prose, no markdown) matching exactly this shape:",
  "{",
  '  "category": string,        // one of: "decision_request" | "fyi" | "risk" | "commitment" | "question" | "noise"',
  '  "importance": number,      // 0..1 — consequence for the operator',
  '  "urgency": number,         // 0..1 — time pressure',
  '  "actionRequired": boolean, // does the operator (or their team) need to act?',
  '  "linkedPeople": string[],  // people named in the item, verbatim',
  '  "topics": string[],        // 1-4 short topic tags',
  '  "confidence": number,      // 0..1 — confidence in this classification',
  '  "rationale": string        // one sentence explaining the classification',
  "}",
].join("\n");

const SIGNAL_RANKING_PROMPT = [
  "You are the signal ranking agent for Paylo.one, a calm intelligence layer for leaders.",
  "You rank a batch of classified items from the operator's connected channels so the most",
  "consequential rise to the top of their attention.",
  "",
  "Rules:",
  "- Rank ONLY the supplied items, by their id tokens (e.g. \"item-1\"). Every itemId in the",
  "  output MUST be a supplied token; include every supplied item exactly once.",
  "- Rank by consequence for the operator, not by recency or volume.",
  "- Weigh: decision requests and commitments owed above FYIs; risks above routine updates;",
  "  items involving people or projects the supplied context marks as important above others;",
  "  explicit deadlines above implicit ones.",
  "- Apply any operator preferences supplied in the context (raised/lowered priorities,",
  "  muted sources) — preferences override your defaults.",
  "- Do not manufacture urgency. A quiet batch should rank as background.",
  "",
  "Return STRICT JSON only (no prose, no markdown) matching exactly this shape:",
  "{",
  '  "ranked": [                // ordered, highest priority first',
  "    {",
  '      "itemId": string,      // a supplied item id token',
  '      "priorityScore": number, // 0..1',
  '      "tier": string,        // one of: "act_now" | "today" | "this_week" | "background"',
  '      "reason": string       // one sentence; cite the deciding factor',
  "    }",
  "  ]",
  "}",
].join("\n");

const SIGNAL_TRIAGE_PROMPT = [
  "You are the triage agent for Paylo.one, a calm intelligence layer for leaders.",
  "You triage and summarise a batch of items from the operator's connected channels:",
  "decide what should be surfaced, grouped, escalated, turned into an action, or ignored —",
  "reducing information overload without losing anything consequential.",
  "",
  "Rules:",
  "- Work ONLY from the supplied items; reference them by their id tokens (e.g. \"item-1\").",
  "  Every itemId MUST be a supplied token. Group related items under one theme.",
  "- Each group gets ONE recommended action for the operator.",
  "- Escalate only genuine risks or blocked decisions; do not manufacture urgency.",
  "- draftNote: a short, ready-to-use note for the operator (a reply opener, a delegation",
  "  brief, or a calendar note) — only when recommendedAction warrants one, else empty.",
  "- The summary is editorial: 2-3 sentences on what matters and why. British spelling.",
  "",
  "Return STRICT JSON only (no prose, no markdown) matching exactly this shape:",
  "{",
  '  "summary": string,         // 2-3 sentence triage summary of the batch',
  '  "groups": [                // ordered, most consequential first',
  "    {",
  '      "theme": string,       // short label for the group',
  '      "itemIds": string[],   // >=1 supplied item id token',
  '      "recommendedAction": string, // one of: "respond" | "delegate" | "schedule" | "escalate" | "turn_into_action" | "ignore"',
  '      "urgency": string,     // one of: "now" | "today" | "this_week" | "none"',
  '      "draftNote": string    // ready-to-use note, or "" when not applicable',
  "    }",
  "  ]",
  "}",
].join("\n");

const ITEMS_VARIABLE: PromptInputVariable = {
  name: "items",
  description:
    "Recent items from connected channels, folded into the user message as [item-N] blocks with timestamp and summary.",
  required: true,
};

export const DEFAULT_PROMPT_CATALOGUE: readonly PromptDefault[] = [
  {
    templateKey: "daily_memo",
    workflow: "Briefing generation",
    name: "Daily briefing synthesis",
    description:
      "Composes the executive daily briefing from connected channels: tone, structure, prioritisation, and the strict-JSON output the memo pipeline validates.",
    content: DAILY_MEMO_SYSTEM_PROMPT,
    inputVariables: [ITEMS_VARIABLE],
    outputFormat: {
      schemaId: "daily_memo_output@1",
      description:
        "Strict JSON: executive summary, ordered sections (each citing source item ids with confidence), and candidate actions.",
      requiredKeys: ["summary", "sections", "actions"],
    },
    modelSettings: { policyName: "daily-memo-synthesis", temperature: 0.3, maxTokens: 1500 },
    catalogueVersion: "1.0.0",
  },
  {
    templateKey: "signal_classification",
    workflow: "Signal classification",
    name: "Incoming signal classification",
    description:
      "Classifies one incoming source item: category, importance, urgency, action required, linked people, topics, and confidence.",
    content: SIGNAL_CLASSIFICATION_PROMPT,
    inputVariables: [
      {
        name: "item",
        description:
          "The single source item to classify: system, title, body, author, occurred_at.",
        required: true,
      },
    ],
    outputFormat: {
      schemaId: "signal_classification_output@1",
      description:
        "Strict JSON: category, importance, urgency, actionRequired, linkedPeople, topics, confidence, rationale.",
      requiredKeys: ["category", "importance", "urgency", "actionRequired", "confidence"],
    },
    modelSettings: { policyName: "default", temperature: 0.1, maxTokens: 600 },
    catalogueVersion: "1.0.0",
  },
  {
    templateKey: "signal_ranking",
    workflow: "Signal ranking",
    name: "Signal ranking & prioritisation",
    description:
      "Ranks a batch of items by consequence for the operator, honouring supplied people/project context and operator preferences.",
    inputVariables: [
      ITEMS_VARIABLE,
      {
        name: "preferences",
        description:
          "Operator refinement preferences (raised/lowered priorities, muted sources), when supplied in the context.",
        required: false,
      },
    ],
    content: SIGNAL_RANKING_PROMPT,
    outputFormat: {
      schemaId: "signal_ranking_output@1",
      description:
        "Strict JSON: ranked list of every supplied item with priorityScore, tier, and a one-sentence reason.",
      requiredKeys: ["ranked"],
    },
    modelSettings: { policyName: "default", temperature: 0.2, maxTokens: 1200 },
    catalogueVersion: "1.0.0",
  },
  {
    templateKey: "signal_triage",
    workflow: "Triage & summarisation",
    name: "Triage & summarisation",
    description:
      "Groups a batch of items into themes, recommends one action per group (respond, delegate, schedule, escalate, turn into action, ignore), and writes the editorial summary.",
    content: SIGNAL_TRIAGE_PROMPT,
    inputVariables: [ITEMS_VARIABLE],
    outputFormat: {
      schemaId: "signal_triage_output@1",
      description:
        "Strict JSON: editorial summary plus ordered groups with itemIds, recommendedAction, urgency, and an optional draft note.",
      requiredKeys: ["summary", "groups"],
    },
    modelSettings: { policyName: "default", temperature: 0.3, maxTokens: 1500 },
    catalogueVersion: "1.0.0",
  },
];

/** Lookup a catalogue default by template key. */
export function getPromptDefault(templateKey: PromptTemplateKey): PromptDefault {
  const found = DEFAULT_PROMPT_CATALOGUE.find((d) => d.templateKey === templateKey);
  if (!found) throw new Error(`unknown prompt template key: ${templateKey}`);
  return found;
}
