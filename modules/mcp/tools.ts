import "server-only";

import { z } from "zod";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import {
  AppError,
  PolicyDeniedError,
  ValidationError,
  type Result,
  err,
  ok,
} from "@/modules/shared";
import { hasScopes, recordMcpAudit } from "./oauth";
import { getTagDefinition } from "@/modules/people/people-tags";
import type { McpAuthContext, McpScope, McpToolDefinition } from "./types";

const MAX_LIMIT = 50;

/** Plain-language reasons a person matters, for MCP consumers (mirrors the UI). */
function buildWhyImportant(input: {
  importance: string;
  tags: readonly string[];
  companyName: string | null;
  signalCount: number;
  actionCount: number;
  topConnection: { relationshipType?: string; otherLabel?: string | null } | null;
}): string[] {
  const reasons: string[] = [];
  if (input.importance === "critical" || input.importance === "high") {
    reasons.push(`Marked ${input.importance} importance, so their activity is prioritised in briefings.`);
  }
  for (const tag of input.tags) {
    const def = getTagDefinition(tag);
    if (def && def.behaviour.wired && def.behaviour.kind !== "raise_importance") {
      reasons.push(`Tagged ${def.label}: ${def.explanation}`);
    }
  }
  if (input.companyName) reasons.push(`Works at ${input.companyName}.`);
  if (input.signalCount > 0) {
    reasons.push(`${input.signalCount} recent source item${input.signalCount === 1 ? "" : "s"} attributed to them.`);
  }
  if (input.actionCount > 0) {
    reasons.push(`${input.actionCount} action${input.actionCount === 1 ? "" : "s"} involve them.`);
  }
  if (input.topConnection?.otherLabel) {
    reasons.push(`${input.topConnection.relationshipType ?? "Connected to"} ${input.topConnection.otherLabel}.`);
  }
  return reasons;
}

function limit(value: unknown, fallback = 10): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(parsed)));
}

function excerpt(value: string | null | undefined, max = 360): string | null {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

const emptySchema = { type: "object", additionalProperties: false };
const querySchema = {
  type: "object",
  properties: {
    query: { type: "string" },
    limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
  },
  required: ["query"],
  additionalProperties: false,
};

const TOOL_DEFINITIONS: readonly McpToolDefinition[] = [
  {
    name: "search_memory",
    description: "Search Pilot memory across sources, briefings, actions, people, and scoped diary entries.",
    requiredScopes: ["memory:read"],
    inputSchema: querySchema,
  },
  {
    name: "get_context",
    description: "Build a structured context pack around a topic, person, project, or decision.",
    requiredScopes: ["memory:read"],
    inputSchema: querySchema,
  },
  {
    name: "summarise_topic",
    description: "Return an extractive summary of what Pilot knows about a topic.",
    requiredScopes: ["memory:read"],
    inputSchema: querySchema,
  },
  {
    name: "get_recent_changes",
    description: "Return meaningful recent changes across the workspace.",
    requiredScopes: ["memory:read"],
    inputSchema: {
      type: "object",
      properties: { days: { type: "number", minimum: 1, maximum: 90 }, limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_latest_briefing",
    description: "Return the latest briefing with sections and source references.",
    requiredScopes: ["briefings:read"],
    inputSchema: emptySchema,
  },
  {
    name: "get_briefing_history",
    description: "Return recent briefings with metadata.",
    requiredScopes: ["briefings:read"],
    inputSchema: { type: "object", properties: { limit: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "list_actions",
    description: "List actions by status, topic, urgency, or source.",
    requiredScopes: ["actions:read"],
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        topic: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_action",
    description: "Create a structured action inside Pilot.",
    requiredScopes: ["actions:write"],
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["critical", "high", "normal", "low"] },
        dueAt: { type: "string" },
        topics: { type: "array", items: { type: "string" } },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "update_action",
    description: "Update action status, due date, priority, or notes.",
    requiredScopes: ["actions:write"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string" },
        dueAt: { type: "string" },
        priority: { type: "string" },
        description: { type: "string" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_risks",
    description: "List open, watched, or resolved risks known to Pilot.",
    requiredScopes: ["risks:read"],
    inputSchema: { type: "object", properties: { status: { type: "string" }, limit: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "list_decisions",
    description: "List decisions from diary entries and briefing sections.",
    requiredScopes: ["decisions:read"],
    inputSchema: querySchema,
  },
  {
    name: "get_decision_context",
    description: "Return supporting context around a decision.",
    requiredScopes: ["decisions:read", "memory:read"],
    inputSchema: querySchema,
  },
  {
    name: "create_diary_entry",
    description: "Create a private diary entry for the authorising user.",
    requiredScopes: ["diary:write"],
    inputSchema: {
      type: "object",
      properties: {
        body: { type: "string" },
        entryType: { type: "string" },
      },
      required: ["body"],
      additionalProperties: false,
    },
  },
  {
    name: "search_diary",
    description: "Search private diary entries where the user granted diary read access.",
    requiredScopes: ["diary:read"],
    inputSchema: querySchema,
  },
  {
    name: "list_people",
    description: "Return people known in the workspace with lightweight metadata.",
    requiredScopes: ["people:read"],
    inputSchema: { type: "object", properties: { limit: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "get_person_context",
    description: "Return relevant context linked to a person.",
    requiredScopes: ["people:read", "memory:read"],
    inputSchema: {
      type: "object",
      properties: { personId: { type: "string" }, query: { type: "string" }, limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "list_companies",
    description: "Return companies known in the workspace with relationship, importance, domains, and linked-people counts.",
    requiredScopes: ["people:read"],
    inputSchema: { type: "object", properties: { limit: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "get_company_context",
    description: "Return context around a company: relationship, domains, aliases, linked people, and connections.",
    requiredScopes: ["people:read"],
    inputSchema: {
      type: "object",
      properties: { companyId: { type: "string" }, query: { type: "string" }, limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_relationship_graph",
    description: "Return the confirmed relationship graph (one hop) around a person or company: connected entities and how they relate.",
    requiredScopes: ["people:read"],
    inputSchema: {
      type: "object",
      properties: {
        entityType: { type: "string", enum: ["person", "company"] },
        entityId: { type: "string" },
        limit: { type: "number" },
      },
      required: ["entityType", "entityId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_topics",
    description: "Return known topics and recent activity counts.",
    requiredScopes: ["memory:read"],
    inputSchema: { type: "object", properties: { limit: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "get_topic_context",
    description: "Return structured context around a topic.",
    requiredScopes: ["memory:read"],
    inputSchema: querySchema,
  },
  {
    name: "list_sources",
    description: "List connected sources and their sync state.",
    requiredScopes: ["sources:read"],
    inputSchema: { type: "object", properties: { limit: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "get_source_references",
    description: "Return source references supporting a memory item, action, briefing section, diary entry, or source item.",
    requiredScopes: ["sources:read"],
    inputSchema: {
      type: "object",
      properties: {
        suggestedActionId: { type: "string" },
        briefingSectionId: { type: "string" },
        diaryEntryId: { type: "string" },
        sourceItemId: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
  },
];

export function listMcpTools(scopes: readonly McpScope[]): McpToolDefinition[] {
  return TOOL_DEFINITIONS.filter((tool) => hasScopes(scopes, tool.requiredScopes));
}

export function getMcpToolDefinition(name: string): McpToolDefinition | null {
  return TOOL_DEFINITIONS.find((tool) => tool.name === name) ?? null;
}

const queryInput = z.object({ query: z.string().trim().min(1).max(200), limit: z.number().optional() });

async function sourceReferencesFor(
  tenantId: string,
  field: string,
  ids: readonly string[],
): Promise<Map<string, any[]>> {
  const byId = new Map<string, any[]>();
  if (ids.length === 0) return byId;
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("source_references")
    .select(
      "id, briefing_section_id, suggested_action_id, diary_entry_id, source_item_id, source_system, item_timestamp, confidence, excerpt_or_pointer, person_id, news_item_id",
    )
    .eq("tenant_id", tenantId)
    .in(field, ids);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const key = String((row as any)[field] ?? "");
    if (!key) continue;
    const list = byId.get(key) ?? [];
    list.push({
      id: row.id,
      sourceSystem: row.source_system,
      itemTimestamp: row.item_timestamp,
      confidence: row.confidence,
      excerptOrPointer: excerpt(row.excerpt_or_pointer, 500),
      personId: row.person_id,
      sourceItemId: row.source_item_id,
      newsItemId: row.news_item_id,
      diaryEntryId: row.diary_entry_id,
    });
    byId.set(key, list);
  }
  return byId;
}

async function searchMemory(auth: McpAuthContext, args: unknown) {
  const input = queryInput.parse(args);
  const take = limit(input.limit, 12);
  const pattern = `%${input.query}%`;
  const secret = createSupabaseSecretClient();

  const [sourceItems, actions, people, briefings, diary] = await Promise.all([
    secret
      .from("source_items")
      .select("id, system, title, body, author, occurred_at, created_at")
      .eq("tenant_id", auth.tenantId)
      .or(`title.ilike.${pattern},body.ilike.${pattern},author.ilike.${pattern}`)
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(take),
    secret
      .from("suggested_actions")
      .select("id, title, rationale, status, priority, due_at, topics, created_at")
      .eq("tenant_id", auth.tenantId)
      .or(`title.ilike.${pattern},rationale.ilike.${pattern},description.ilike.${pattern}`)
      .order("created_at", { ascending: false })
      .limit(take),
    hasScopes(auth.scopes, ["people:read"])
      ? secret
          .from("people")
          .select("id, display_name, role_title, organisation, importance_level, status, updated_at")
          .eq("tenant_id", auth.tenantId)
          .or(`display_name.ilike.${pattern},role_title.ilike.${pattern},organisation.ilike.${pattern}`)
          .limit(take)
      : Promise.resolve({ data: [], error: null }),
    secret
      .from("briefings")
      .select("id, summary, status, generated_at")
      .eq("tenant_id", auth.tenantId)
      .ilike("summary", pattern)
      .order("generated_at", { ascending: false })
      .limit(take),
    hasScopes(auth.scopes, ["diary:read"])
      ? secret
          .from("diary_entries")
          .select("id, entry_type, kind, body, transcript, created_at, updated_at")
          .eq("tenant_id", auth.tenantId)
          .eq("author_user_id", auth.userId)
          .or(`body.ilike.${pattern},transcript.ilike.${pattern}`)
          .order("created_at", { ascending: false })
          .limit(take)
      : Promise.resolve({ data: [], error: null }),
  ]);

  for (const response of [sourceItems, actions, people, briefings, diary]) {
    if (response.error) throw new Error(response.error.message);
  }

  return {
    query: input.query,
    results: [
      ...(sourceItems.data ?? []).map((row: any) => ({
        type: "source_item",
        id: row.id,
        title: row.title ?? row.system,
        summary: excerpt(row.body),
        sourceSystem: row.system,
        occurredAt: row.occurred_at ?? row.created_at,
      })),
      ...(actions.data ?? []).map((row: any) => ({
        type: "action",
        id: row.id,
        title: row.title,
        summary: excerpt(row.rationale),
        status: row.status,
        priority: row.priority,
        dueAt: row.due_at,
        topics: row.topics ?? [],
        occurredAt: row.created_at,
      })),
      ...(people.data ?? []).map((row: any) => ({
        type: "person",
        id: row.id,
        title: row.display_name,
        roleTitle: row.role_title,
        organisation: row.organisation,
        importance: row.importance_level,
        status: row.status,
        occurredAt: row.updated_at,
      })),
      ...(briefings.data ?? []).map((row: any) => ({
        type: "briefing",
        id: row.id,
        title: "Briefing",
        summary: excerpt(row.summary),
        status: row.status,
        occurredAt: row.generated_at,
      })),
      ...(diary.data ?? []).map((row: any) => ({
        type: "diary_entry",
        id: row.id,
        title: row.entry_type,
        summary: excerpt(row.transcript || row.body),
        kind: row.kind,
        occurredAt: row.created_at,
      })),
    ].slice(0, take),
  };
}

async function latestBriefing(auth: McpAuthContext) {
  const secret = createSupabaseSecretClient();
  const { data: briefing, error } = await secret
    .from("briefings")
    .select("id, status, summary, generated_at")
    .eq("tenant_id", auth.tenantId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!briefing) return null;

  const { data: sections, error: sectionError } = await secret
    .from("briefing_sections")
    .select("id, kind, position, title, body")
    .eq("briefing_id", briefing.id)
    .order("position", { ascending: true });
  if (sectionError) throw new Error(sectionError.message);
  const refs = await sourceReferencesFor(
    auth.tenantId,
    "briefing_section_id",
    (sections ?? []).map((section: any) => section.id),
  );
  return {
    id: briefing.id,
    status: briefing.status,
    summary: briefing.summary,
    generatedAt: briefing.generated_at,
    sections: (sections ?? []).map((section: any) => ({
      id: section.id,
      kind: section.kind,
      position: section.position,
      title: section.title,
      body: section.body,
      references: refs.get(section.id) ?? [],
    })),
  };
}

async function listActions(auth: McpAuthContext, args: unknown) {
  const input = z
    .object({ status: z.string().optional(), topic: z.string().optional(), limit: z.number().optional() })
    .parse(args);
  const secret = createSupabaseSecretClient();
  let query = secret
    .from("suggested_actions")
    .select(
      "id, title, description, rationale, status, priority, due_at, follow_up_at, completed_at, created_from, topics, person_id, created_at, updated_at",
    )
    .eq("tenant_id", auth.tenantId)
    .order("created_at", { ascending: false })
    .limit(limit(input.limit, 25));
  if (input.status) query = query.eq("status", input.status);
  if (input.topic) query = query.contains("topics", [input.topic]);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const refs = await sourceReferencesFor(
    auth.tenantId,
    "suggested_action_id",
    (data ?? []).map((action: any) => action.id),
  );
  return (data ?? []).map((action: any) => ({
    id: action.id,
    title: action.title,
    description: excerpt(action.description, 700),
    rationale: excerpt(action.rationale, 700),
    status: action.status,
    priority: action.priority,
    dueAt: action.due_at,
    followUpAt: action.follow_up_at,
    completedAt: action.completed_at,
    createdFrom: action.created_from,
    topics: action.topics ?? [],
    personId: action.person_id,
    createdAt: action.created_at,
    updatedAt: action.updated_at,
    references: refs.get(action.id) ?? [],
  }));
}

async function createAction(auth: McpAuthContext, args: unknown) {
  const input = z
    .object({
      title: z.string().trim().min(1).max(240),
      description: z.string().trim().max(4000).optional(),
      priority: z.enum(["critical", "high", "normal", "low"]).optional(),
      dueAt: z.string().datetime().optional(),
      topics: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    })
    .parse(args);
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("suggested_actions")
    .insert({
      tenant_id: auth.tenantId,
      created_by: auth.userId,
      created_from: "manual",
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? "normal",
      status: "inbox",
      due_at: input.dueAt ?? null,
      topics: input.topics ?? [],
      rationale: `Created by MCP client ${auth.clientName}.`,
    })
    .select("id, title, status, priority, created_at")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateAction(auth: McpAuthContext, args: unknown) {
  const input = z
    .object({
      id: z.string().uuid(),
      status: z.enum(["inbox", "planned", "in_progress", "waiting", "follow_up", "completed", "cancelled"]).optional(),
      dueAt: z.string().datetime().nullable().optional(),
      priority: z.enum(["critical", "high", "normal", "low"]).optional(),
      description: z.string().trim().max(4000).optional(),
    })
    .parse(args);
  const patch: Record<string, unknown> = {};
  if (input.status) {
    patch.status = input.status;
    if (input.status === "completed") patch.completed_at = new Date().toISOString();
  }
  if (input.dueAt !== undefined) patch.due_at = input.dueAt;
  if (input.priority) patch.priority = input.priority;
  if (input.description !== undefined) patch.description = input.description;
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("suggested_actions")
    .update(patch)
    .eq("tenant_id", auth.tenantId)
    .eq("id", input.id)
    .select("id, title, status, priority, due_at, completed_at, updated_at")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ValidationError("Action not found in this workspace.");
  return data;
}

async function listRisks(auth: McpAuthContext, args: unknown) {
  const input = z.object({ status: z.string().optional(), limit: z.number().optional() }).parse(args);
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("diary_entries")
    .select("id, entry_type, body, transcript, risk_status, risk_resolved_at, created_at, updated_at")
    .eq("tenant_id", auth.tenantId)
    .eq("author_user_id", auth.userId)
    .eq("entry_type", "risk")
    .order("created_at", { ascending: false })
    .limit(limit(input.limit, 20));
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((risk: any) => !input.status || (risk.risk_status ?? "active") === input.status)
    .map((risk: any) => ({
      id: risk.id,
      status: risk.risk_status ?? "active",
      summary: excerpt(risk.transcript || risk.body, 700),
      createdAt: risk.created_at,
      updatedAt: risk.updated_at,
      resolvedAt: risk.risk_resolved_at,
    }));
}

async function listDecisions(auth: McpAuthContext, args: unknown) {
  const input = queryInput.partial({ query: true }).parse(args);
  const pattern = input.query ? `%${input.query}%` : "%";
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("diary_entries")
    .select("id, kind, body, transcript, created_at, updated_at")
    .eq("tenant_id", auth.tenantId)
    .eq("author_user_id", auth.userId)
    .eq("entry_type", "decision")
    .or(`body.ilike.${pattern},transcript.ilike.${pattern}`)
    .order("created_at", { ascending: false })
    .limit(limit(input.limit, 20));
  if (error) throw new Error(error.message);
  return (data ?? []).map((decision: any) => ({
    id: decision.id,
    summary: excerpt(decision.transcript || decision.body, 900),
    kind: decision.kind,
    createdAt: decision.created_at,
    updatedAt: decision.updated_at,
  }));
}

async function createDiaryEntry(auth: McpAuthContext, args: unknown) {
  const input = z
    .object({
      body: z.string().trim().min(1).max(20_000),
      entryType: z
        .enum(["note", "decision", "action", "reflection", "meeting", "idea", "risk", "follow_up"])
        .optional(),
    })
    .parse(args);
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("diary_entries")
    .insert({
      tenant_id: auth.tenantId,
      author_user_id: auth.userId,
      kind: "text",
      entry_type: input.entryType ?? "note",
      body: input.body,
      transcription_status: "none",
      risk_status: input.entryType === "risk" ? "active" : null,
    })
    .select("id, entry_type, kind, created_at")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function searchDiary(auth: McpAuthContext, args: unknown) {
  const input = queryInput.parse(args);
  const secret = createSupabaseSecretClient();
  const pattern = `%${input.query}%`;
  const { data, error } = await secret
    .from("diary_entries")
    .select("id, entry_type, kind, body, transcript, risk_status, created_at, updated_at")
    .eq("tenant_id", auth.tenantId)
    .eq("author_user_id", auth.userId)
    .or(`body.ilike.${pattern},transcript.ilike.${pattern}`)
    .order("created_at", { ascending: false })
    .limit(limit(input.limit, 20));
  if (error) throw new Error(error.message);
  return (data ?? []).map((entry: any) => ({
    id: entry.id,
    entryType: entry.entry_type,
    kind: entry.kind,
    summary: excerpt(entry.transcript || entry.body, 900),
    riskStatus: entry.risk_status,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  }));
}

async function listPeopleTool(auth: McpAuthContext, args: unknown) {
  const input = z.object({ limit: z.number().optional() }).parse(args);
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("people")
    .select("id, display_name, role_title, organisation, relationship_type, importance_level, status, notes, updated_at")
    .eq("tenant_id", auth.tenantId)
    .order("display_name", { ascending: true })
    .limit(limit(input.limit, 30));
  if (error) throw new Error(error.message);
  return (data ?? []).map((person: any) => ({
    id: person.id,
    displayName: person.display_name,
    roleTitle: person.role_title,
    organisation: person.organisation,
    relationshipType: person.relationship_type,
    importance: person.importance_level,
    status: person.status,
    notes: excerpt(person.notes, 300),
    updatedAt: person.updated_at,
  }));
}

async function getPersonContext(auth: McpAuthContext, args: unknown) {
  const input = z
    .object({
      personId: z.string().uuid().optional(),
      query: z.string().trim().min(1).max(200).optional(),
      limit: z.number().optional(),
    })
    .refine((value) => value.personId || value.query, {
      message: "Provide personId or query.",
    })
    .parse(args);
  const take = limit(input.limit, 12);
  const secret = createSupabaseSecretClient();

  let personQuery = secret
    .from("people")
    .select(
      "id, display_name, role_title, organisation, company_id, relationship_type, importance_level, status, is_self, notes, created_at, updated_at",
    )
    .eq("tenant_id", auth.tenantId)
    .limit(1);

  if (input.personId) {
    personQuery = personQuery.eq("id", input.personId);
  } else {
    personQuery = personQuery.ilike("display_name", `%${input.query}%`);
  }

  const { data: people, error: personError } = await personQuery;
  if (personError) throw new Error(personError.message);
  const person = people?.[0];
  if (!person) {
    return {
      person: null,
      actions: [],
      sourceReferences: [],
      sourceItems: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const [identities, tags, actions, references] = await Promise.all([
    secret
      .from("person_identities")
      .select("id, source_type, identity_type, identity_value, provider_user_id, confidence, verified_by_user")
      .eq("person_id", person.id)
      .limit(20),
    secret.from("person_tags").select("tag").eq("person_id", person.id).limit(20),
    hasScopes(auth.scopes, ["actions:read"])
      ? secret
          .from("suggested_actions")
          .select(
            "id, title, description, rationale, status, priority, due_at, follow_up_at, completed_at, created_from, topics, created_at, updated_at",
          )
          .eq("tenant_id", auth.tenantId)
          .eq("person_id", person.id)
          .order("updated_at", { ascending: false })
          .limit(take)
      : Promise.resolve({ data: [], error: null }),
    secret
      .from("source_references")
      .select(
        "id, source_system, item_timestamp, confidence, excerpt_or_pointer, suggested_action_id, briefing_section_id, source_item_id, diary_entry_id, news_item_id",
      )
      .eq("tenant_id", auth.tenantId)
      .eq("person_id", person.id)
      .order("item_timestamp", { ascending: false, nullsFirst: false })
      .limit(take),
  ]);

  for (const response of [identities, tags, actions, references]) {
    if (response.error) throw new Error(response.error.message);
  }

  const sourceItemIds = [
    ...new Set(
      (references.data ?? [])
        .map((reference: any) => reference.source_item_id)
        .filter(Boolean),
    ),
  ].slice(0, take);

  let sourceItems: any[] = [];
  if (sourceItemIds.length > 0) {
    const { data, error } = await secret
      .from("source_items")
      .select("id, system, title, body, author, occurred_at, created_at")
      .eq("tenant_id", auth.tenantId)
      .in("id", sourceItemIds);
    if (error) throw new Error(error.message);
    sourceItems = data ?? [];
  }

  // Resolve company + confirmed relationships for "why this person matters".
  let companyName: string | null = null;
  if (person.company_id) {
    const { data: companyRow } = await secret
      .from("companies")
      .select("name")
      .eq("tenant_id", auth.tenantId)
      .eq("id", person.company_id)
      .maybeSingle();
    companyName = (companyRow as { name: string } | null)?.name ?? null;
  }
  const graph = await getRelationshipGraphTool(auth, {
    entityType: "person",
    entityId: person.id,
    limit: 20,
    includeSuggested: true,
  });
  const personTags = (tags.data ?? []).map((tag: any) => tag.tag);
  const whyImportant = buildWhyImportant({
    importance: person.importance_level,
    tags: personTags,
    companyName,
    signalCount: sourceItemIds.length,
    actionCount: (actions.data ?? []).length,
    topConnection: (graph as any).edges?.[0] ?? null,
  });

  return {
    person: {
      id: person.id,
      displayName: person.display_name,
      roleTitle: person.role_title,
      organisation: person.organisation,
      company: companyName ? { id: person.company_id, name: companyName } : null,
      relationshipType: person.relationship_type,
      importance: person.importance_level,
      status: person.status,
      isSelf: person.is_self ?? false,
      notes: excerpt(person.notes, 500),
      whyImportant,
      connections: (graph as any).edges,
      tags: personTags,
      identities: (identities.data ?? []).map((identity: any) => ({
        id: identity.id,
        sourceType: identity.source_type,
        identityType: identity.identity_type,
        identityValue: identity.identity_value,
        providerUserId: identity.provider_user_id,
        confidence: identity.confidence,
        verifiedByUser: identity.verified_by_user,
      })),
      createdAt: person.created_at,
      updatedAt: person.updated_at,
    },
    actions: (actions.data ?? []).map((action: any) => ({
      id: action.id,
      title: action.title,
      description: excerpt(action.description, 500),
      rationale: excerpt(action.rationale, 500),
      status: action.status,
      priority: action.priority,
      dueAt: action.due_at,
      followUpAt: action.follow_up_at,
      completedAt: action.completed_at,
      createdFrom: action.created_from,
      topics: action.topics ?? [],
      createdAt: action.created_at,
      updatedAt: action.updated_at,
    })),
    sourceReferences: (references.data ?? []).map((reference: any) => ({
      id: reference.id,
      sourceSystem: reference.source_system,
      itemTimestamp: reference.item_timestamp,
      confidence: reference.confidence,
      excerptOrPointer: excerpt(reference.excerpt_or_pointer, 700),
      suggestedActionId: reference.suggested_action_id,
      briefingSectionId: reference.briefing_section_id,
      sourceItemId: reference.source_item_id,
      diaryEntryId: reference.diary_entry_id,
      newsItemId: reference.news_item_id,
    })),
    sourceItems: sourceItems.map((item: any) => ({
      id: item.id,
      system: item.system,
      title: item.title,
      summary: excerpt(item.body, 500),
      author: item.author,
      occurredAt: item.occurred_at ?? item.created_at,
    })),
    generatedAt: new Date().toISOString(),
  };
}

async function companyCountsByPerson(tenantId: string): Promise<Map<string, number>> {
  const secret = createSupabaseSecretClient();
  const { data } = await secret.from("people").select("company_id").eq("tenant_id", tenantId);
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { company_id: string | null }[]) {
    if (row.company_id) counts.set(row.company_id, (counts.get(row.company_id) ?? 0) + 1);
  }
  return counts;
}

async function listCompaniesTool(auth: McpAuthContext, args: unknown) {
  const input = z.object({ limit: z.number().optional() }).parse(args);
  const secret = createSupabaseSecretClient();
  const [{ data, error }, peopleCounts, { data: domainData }] = await Promise.all([
    secret
      .from("companies")
      .select("id, name, relationship_type, importance_level, status, notes, updated_at")
      .eq("tenant_id", auth.tenantId)
      .order("name", { ascending: true })
      .limit(limit(input.limit, 30)),
    companyCountsByPerson(auth.tenantId),
    secret.from("company_domains").select("company_id, domain").eq("tenant_id", auth.tenantId),
  ]);
  if (error) throw new Error(error.message);
  const domainsByCompany = new Map<string, string[]>();
  for (const d of (domainData ?? []) as { company_id: string; domain: string }[]) {
    const list = domainsByCompany.get(d.company_id) ?? [];
    list.push(d.domain);
    domainsByCompany.set(d.company_id, list);
  }
  return (data ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    relationshipType: c.relationship_type,
    importance: c.importance_level,
    status: c.status,
    notes: excerpt(c.notes, 300),
    domains: domainsByCompany.get(c.id) ?? [],
    relatedPeopleCount: peopleCounts.get(c.id) ?? 0,
    updatedAt: c.updated_at,
  }));
}

/** Resolve person + company labels for a set of graph endpoints (secret client). */
async function resolveGraphLabels(
  tenantId: string,
  links: { source_entity_type: string; source_entity_id: string; target_entity_type: string; target_entity_id: string }[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const personIds = new Set<string>();
  const companyIds = new Set<string>();
  for (const l of links) {
    for (const [t, id] of [
      [l.source_entity_type, l.source_entity_id],
      [l.target_entity_type, l.target_entity_id],
    ] as const) {
      if (t === "person") personIds.add(id);
      if (t === "company") companyIds.add(id);
    }
  }
  const secret = createSupabaseSecretClient();
  if (personIds.size > 0) {
    const { data } = await secret.from("people").select("id, display_name").eq("tenant_id", tenantId).in("id", [...personIds]);
    for (const p of (data ?? []) as { id: string; display_name: string }[]) labels.set(`person:${p.id}`, p.display_name);
  }
  if (companyIds.size > 0) {
    const { data } = await secret.from("companies").select("id, name").eq("tenant_id", tenantId).in("id", [...companyIds]);
    for (const c of (data ?? []) as { id: string; name: string }[]) labels.set(`company:${c.id}`, c.name);
  }
  return labels;
}

async function relationshipGraphRows(
  auth: McpAuthContext,
  entityType: string,
  entityId: string,
  take: number,
  includeSuggested = false,
) {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("entity_links")
    .select(
      "id, source_entity_type, source_entity_id, target_entity_type, target_entity_id, relationship_type, confidence, origin, status, evidence_summary, visibility, last_seen_at",
    )
    .eq("tenant_id", auth.tenantId)
    .in("status", includeSuggested ? ["confirmed", "suggested"] : ["confirmed"])
    .or(
      `and(source_entity_type.eq.${entityType},source_entity_id.eq.${entityId}),and(target_entity_type.eq.${entityType},target_entity_id.eq.${entityId})`,
    )
    .limit(take);
  if (error) throw new Error(error.message);
  const visible = ((data ?? []) as any[]).filter((l) => l.visibility !== "hidden");
  const diaryIds = new Set<string>();
  for (const link of visible) {
    if (link.source_entity_type === "diary_entry") diaryIds.add(link.source_entity_id);
    if (link.target_entity_type === "diary_entry") diaryIds.add(link.target_entity_id);
  }
  if (diaryIds.size === 0) return visible;
  if (!hasScopes(auth.scopes, ["diary:read"])) {
    return visible.filter((l) => l.source_entity_type !== "diary_entry" && l.target_entity_type !== "diary_entry");
  }
  const { data: diaryRows, error: diaryError } = await secret
    .from("diary_entries")
    .select("id")
    .eq("tenant_id", auth.tenantId)
    .eq("author_user_id", auth.userId)
    .in("id", [...diaryIds]);
  if (diaryError) throw new Error(diaryError.message);
  const readableDiaryIds = new Set(((diaryRows ?? []) as { id: string }[]).map((entry) => entry.id));
  return visible.filter((link) => {
    const sourceDiary = link.source_entity_type === "diary_entry" ? link.source_entity_id : null;
    const targetDiary = link.target_entity_type === "diary_entry" ? link.target_entity_id : null;
    return (
      (!sourceDiary || readableDiaryIds.has(sourceDiary)) &&
      (!targetDiary || readableDiaryIds.has(targetDiary))
    );
  });
}

async function getRelationshipGraphTool(auth: McpAuthContext, args: unknown) {
  const input = z
    .object({
      entityType: z.enum(["person", "company"]),
      entityId: z.string().uuid(),
      limit: z.number().optional(),
      includeSuggested: z.boolean().optional(),
    })
    .parse(args);
  const rows = await relationshipGraphRows(
    auth,
    input.entityType,
    input.entityId,
    limit(input.limit, 50),
    input.includeSuggested ?? false,
  );
  const labels = await resolveGraphLabels(auth.tenantId, rows);
  const rootLabel = labels.get(`${input.entityType}:${input.entityId}`) ?? null;
  const edges = rows.map((l) => {
    const outgoing = l.source_entity_type === input.entityType && l.source_entity_id === input.entityId;
    const otherType = outgoing ? l.target_entity_type : l.source_entity_type;
    const otherId = outgoing ? l.target_entity_id : l.source_entity_id;
    return {
      id: l.id,
      relationshipType: l.relationship_type,
      otherType,
      otherId,
      otherLabel: labels.get(`${otherType}:${otherId}`) ?? null,
      confidence: l.confidence,
      origin: l.origin,
      status: l.status,
      evidence: excerpt(l.evidence_summary, 300),
      lastSeenAt: l.last_seen_at,
    };
  });
  return {
    root: { type: input.entityType, id: input.entityId, label: rootLabel },
    edges,
    generatedAt: new Date().toISOString(),
  };
}

async function getCompanyContext(auth: McpAuthContext, args: unknown) {
  const input = z
    .object({
      companyId: z.string().uuid().optional(),
      query: z.string().trim().min(1).max(200).optional(),
      limit: z.number().optional(),
    })
    .refine((v) => v.companyId || v.query, { message: "Provide companyId or query." })
    .parse(args);
  const take = limit(input.limit, 20);
  const secret = createSupabaseSecretClient();

  let companyQuery = secret
    .from("companies")
    .select("id, name, relationship_type, importance_level, status, notes, created_at, updated_at")
    .eq("tenant_id", auth.tenantId)
    .limit(1);
  companyQuery = input.companyId
    ? companyQuery.eq("id", input.companyId)
    : companyQuery.ilike("name", `%${input.query}%`);

  const { data: companies, error } = await companyQuery;
  if (error) throw new Error(error.message);
  const company = companies?.[0];
  if (!company) return { company: null, people: [], generatedAt: new Date().toISOString() };

  const [{ data: domains }, { data: aliases }, { data: tags }, { data: people }] = await Promise.all([
    secret.from("company_domains").select("domain").eq("company_id", company.id),
    secret.from("company_aliases").select("alias").eq("company_id", company.id),
    secret.from("company_tags").select("tag").eq("company_id", company.id),
    secret
      .from("people")
      .select("id, display_name, role_title")
      .eq("tenant_id", auth.tenantId)
      .eq("company_id", company.id)
      .limit(take),
  ]);

  const graph = await getRelationshipGraphTool(auth, {
    entityType: "company",
    entityId: company.id,
    limit: take,
    includeSuggested: true,
  });

  return {
    company: {
      id: company.id,
      name: company.name,
      relationshipType: company.relationship_type,
      importance: company.importance_level,
      status: company.status,
      notes: excerpt(company.notes, 500),
      domains: (domains ?? []).map((d: any) => d.domain),
      aliases: (aliases ?? []).map((a: any) => a.alias),
      tags: (tags ?? []).map((t: any) => t.tag),
      createdAt: company.created_at,
      updatedAt: company.updated_at,
    },
    people: (people ?? []).map((p: any) => ({ id: p.id, displayName: p.display_name, roleTitle: p.role_title })),
    connections: (graph as any).edges,
    generatedAt: new Date().toISOString(),
  };
}

async function listTopics(auth: McpAuthContext, args: unknown) {
  const input = z.object({ limit: z.number().optional() }).parse(args);
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("suggested_actions")
    .select("topics, updated_at")
    .eq("tenant_id", auth.tenantId)
    .not("topics", "is", null)
    .limit(200);
  if (error) throw new Error(error.message);
  const counts = new Map<string, { count: number; lastActivityAt: string | null }>();
  for (const row of data ?? []) {
    for (const topic of row.topics ?? []) {
      const prev = counts.get(topic) ?? { count: 0, lastActivityAt: null };
      counts.set(topic, {
        count: prev.count + 1,
        lastActivityAt:
          !prev.lastActivityAt || row.updated_at > prev.lastActivityAt
            ? row.updated_at
            : prev.lastActivityAt,
      });
    }
  }
  return [...counts.entries()]
    .map(([topic, meta]) => ({ topic, ...meta }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit(input.limit, 30));
}

async function listSources(auth: McpAuthContext, args: unknown) {
  const input = z.object({ limit: z.number().optional() }).parse(args);
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("source_connections")
    .select("id, system, label, status, storage_policy, last_synced_at, sync_frequency, sync_status, last_sync_error, updated_at")
    .eq("tenant_id", auth.tenantId)
    .order("updated_at", { ascending: false })
    .limit(limit(input.limit, 30));
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function getSourceReferences(auth: McpAuthContext, args: unknown) {
  const input = z
    .object({
      suggestedActionId: z.string().uuid().optional(),
      briefingSectionId: z.string().uuid().optional(),
      diaryEntryId: z.string().uuid().optional(),
      sourceItemId: z.string().uuid().optional(),
      limit: z.number().optional(),
    })
    .refine(
      (value) =>
        Boolean(value.suggestedActionId || value.briefingSectionId || value.diaryEntryId || value.sourceItemId),
      "Provide an item id to look up source references.",
    )
    .parse(args);
  const secret = createSupabaseSecretClient();
  let query = secret
    .from("source_references")
    .select(
      "id, source_system, item_timestamp, confidence, excerpt_or_pointer, suggested_action_id, briefing_section_id, diary_entry_id, source_item_id, person_id, news_item_id",
    )
    .eq("tenant_id", auth.tenantId)
    .limit(limit(input.limit, 30));
  if (input.suggestedActionId) query = query.eq("suggested_action_id", input.suggestedActionId);
  if (input.briefingSectionId) query = query.eq("briefing_section_id", input.briefingSectionId);
  if (input.diaryEntryId) query = query.eq("diary_entry_id", input.diaryEntryId);
  if (input.sourceItemId) query = query.eq("source_item_id", input.sourceItemId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((ref: any) => ({
    ...ref,
    excerpt_or_pointer: excerpt(ref.excerpt_or_pointer, 700),
  }));
}

async function briefingHistory(auth: McpAuthContext, args: unknown) {
  const input = z.object({ limit: z.number().optional() }).parse(args);
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("briefings")
    .select("id, status, summary, generated_at")
    .eq("tenant_id", auth.tenantId)
    .order("generated_at", { ascending: false })
    .limit(limit(input.limit, 10));
  if (error) throw new Error(error.message);
  return (data ?? []).map((briefing: any) => ({
    id: briefing.id,
    status: briefing.status,
    summary: excerpt(briefing.summary, 800),
    generatedAt: briefing.generated_at,
  }));
}

async function recentChanges(auth: McpAuthContext, args: unknown) {
  const input = z.object({ days: z.number().min(1).max(90).optional(), limit: z.number().optional() }).parse(args);
  const since = daysAgo(input.days ?? 7);
  const take = limit(input.limit, 20);
  const secret = createSupabaseSecretClient();
  const [sources, actions, briefings, diary] = await Promise.all([
    secret
      .from("source_items")
      .select("id, system, title, author, occurred_at, created_at")
      .eq("tenant_id", auth.tenantId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(take),
    secret
      .from("suggested_actions")
      .select("id, title, status, priority, due_at, topics, updated_at, created_at")
      .eq("tenant_id", auth.tenantId)
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(take),
    secret
      .from("briefings")
      .select("id, status, summary, generated_at")
      .eq("tenant_id", auth.tenantId)
      .gte("generated_at", since)
      .order("generated_at", { ascending: false })
      .limit(take),
    hasScopes(auth.scopes, ["diary:read"])
      ? secret
          .from("diary_entries")
          .select("id, entry_type, kind, created_at, updated_at")
          .eq("tenant_id", auth.tenantId)
          .eq("author_user_id", auth.userId)
          .gte("updated_at", since)
          .order("updated_at", { ascending: false })
          .limit(take)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const response of [sources, actions, briefings, diary]) {
    if (response.error) throw new Error(response.error.message);
  }
  return {
    since,
    sourceItems: sources.data ?? [],
    actions: actions.data ?? [],
    briefings: (briefings.data ?? []).map((briefing: any) => ({
      ...briefing,
      summary: excerpt(briefing.summary, 500),
    })),
    diaryEntries: diary.data ?? [],
  };
}

async function contextPack(auth: McpAuthContext, args: unknown) {
  const input = queryInput.parse(args);
  const [memory, actions, people, risks] = await Promise.all([
    searchMemory(auth, input),
    hasScopes(auth.scopes, ["actions:read"]) ? listActions(auth, { topic: input.query, limit: 10 }) : [],
    hasScopes(auth.scopes, ["people:read"]) ? listPeopleTool(auth, { limit: 10 }) : [],
    hasScopes(auth.scopes, ["risks:read"]) ? listRisks(auth, { limit: 10 }) : [],
  ]);
  return {
    subject: input.query,
    memory: (memory as any).results,
    actions,
    people: (people as any[]).filter((person) =>
      [person.displayName, person.roleTitle, person.organisation]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(input.query.toLowerCase()),
    ),
    risks,
    generatedAt: new Date().toISOString(),
  };
}

async function execute(name: string, auth: McpAuthContext, args: unknown): Promise<unknown> {
  switch (name) {
    case "search_memory":
      return searchMemory(auth, args);
    case "get_context":
    case "get_topic_context":
    case "get_decision_context":
      return contextPack(auth, args);
    case "get_person_context":
      return getPersonContext(auth, args);
    case "summarise_topic": {
      const pack = (await contextPack(auth, args)) as any;
      return {
        topic: pack.subject,
        summary: pack.memory.slice(0, 5).map((item: any) => item.summary ?? item.title).filter(Boolean),
        openActions: (pack.actions ?? []).filter((action: any) => !["completed", "cancelled"].includes(action.status)),
        unresolvedRisks: pack.risks ?? [],
        citations: pack.memory.flatMap((item: any) => item.references ?? []),
      };
    }
    case "get_recent_changes":
      return recentChanges(auth, args);
    case "get_latest_briefing":
      return latestBriefing(auth);
    case "get_briefing_history":
      return briefingHistory(auth, args);
    case "list_actions":
      return listActions(auth, args);
    case "create_action":
      return createAction(auth, args);
    case "update_action":
      return updateAction(auth, args);
    case "list_risks":
      return listRisks(auth, args);
    case "list_decisions":
      return listDecisions(auth, args);
    case "create_diary_entry":
      return createDiaryEntry(auth, args);
    case "search_diary":
      return searchDiary(auth, args);
    case "list_people":
      return listPeopleTool(auth, args);
    case "list_companies":
      return listCompaniesTool(auth, args);
    case "get_company_context":
      return getCompanyContext(auth, args);
    case "get_relationship_graph":
      return getRelationshipGraphTool(auth, args);
    case "list_topics":
      return listTopics(auth, args);
    case "list_sources":
      return listSources(auth, args);
    case "get_source_references":
      return getSourceReferences(auth, args);
    default:
      throw new ValidationError("Unknown MCP tool.");
  }
}

async function enforceRateLimit(auth: McpAuthContext): Promise<Result<void>> {
  const secret = createSupabaseSecretClient();
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await secret
    .from("mcp_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", auth.tenantId)
    .eq("grant_id", auth.grantId)
    .gte("created_at", since);
  if (error) {
    return err(new AppError("internal", error.message));
  }
  if ((count ?? 0) >= 120) {
    return err(new AppError("rate_limited", "This MCP client is sending too many requests. Try again shortly."));
  }
  return ok(undefined);
}

export async function callMcpTool(
  auth: McpAuthContext,
  name: string,
  args: unknown,
): Promise<Result<unknown>> {
  const tool = getMcpToolDefinition(name);
  if (!tool) {
    return err(new ValidationError("Unknown MCP tool."));
  }
  if (!hasScopes(auth.scopes, tool.requiredScopes)) {
    await recordMcpAudit(auth, {
      eventType: "mcp.tool.denied",
      toolName: name,
      status: "denied",
      metadata: { requiredScopes: tool.requiredScopes },
    });
    return err(new PolicyDeniedError("The MCP grant does not include the scope this tool needs."));
  }

  const rateLimit = await enforceRateLimit(auth);
  if (!rateLimit.ok) {
    await recordMcpAudit(auth, {
      eventType: "mcp.tool.denied",
      toolName: name,
      status: "denied",
      metadata: { reason: rateLimit.error.code },
    });
    return rateLimit;
  }

  try {
    const content = await execute(name, auth, args ?? {});
    await recordMcpAudit(auth, {
      eventType: "mcp.tool.called",
      toolName: name,
      status: "success",
      metadata: { requiredScopes: tool.requiredScopes },
    });
    return ok(content);
  } catch (cause) {
    await recordMcpAudit(auth, {
      eventType: "mcp.tool.error",
      toolName: name,
      status: "error",
      metadata: { message: cause instanceof Error ? cause.message : String(cause) },
    });
    if (cause instanceof AppError) return err(cause);
    if (cause instanceof z.ZodError) {
      return err(new ValidationError("The MCP tool input is not valid.", { issues: cause.issues }));
    }
    return err(new AppError("internal", cause instanceof Error ? cause.message : "MCP tool failed."));
  }
}
