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
import type { McpAuthContext, McpScope, McpToolDefinition } from "./types";

const MAX_LIMIT = 50;

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
    case "get_person_context":
    case "get_decision_context":
      return contextPack(auth, args);
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
