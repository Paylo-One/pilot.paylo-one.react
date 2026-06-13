import { z } from "zod";

export const tenantStatusSchema = z.enum([
  "provisioning",
  "active",
  "suspended",
  "deleting",
  "deleted",
]);
export type TenantStatus = z.infer<typeof tenantStatusSchema>;

export const tenantSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1),
  name: z.string().min(1),
  status: tenantStatusSchema,
  plan: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Tenant = z.infer<typeof tenantSchema>;

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable(),
  displayName: z.string().nullable(),
  timezone: z.string().min(1),
  defaultTenantId: z.string().uuid().nullable(),
});
export type User = z.infer<typeof userSchema>;

export const briefingItemPrioritySchema = z.enum([
  "critical",
  "high",
  "normal",
  "low",
]);
export type BriefingItemPriority = z.infer<typeof briefingItemPrioritySchema>;

export const briefingItemStatusSchema = z.enum([
  "pending",
  "approved",
  "dismissed",
  "snoozed",
]);
export type BriefingItemStatus = z.infer<typeof briefingItemStatusSchema>;

export const briefingFeedbackSchema = z.enum([
  "more_like_this",
  "less_like_this",
  "important",
  "not_relevant",
  "hide_source",
  "follow_topic",
  "unfollow_topic",
]);
export type BriefingFeedback = z.infer<typeof briefingFeedbackSchema>;

export const briefingItemSchema = z.object({
  id: z.string().uuid(),
  briefingId: z.string().uuid(),
  title: z.string().min(1),
  summary: z.string().nullable(),
  whyItMatters: z.string().nullable(),
  priority: briefingItemPrioritySchema,
  status: briefingItemStatusSchema,
  sourceType: z.string().min(1),
  sourceName: z.string().nullable(),
  sourceUrl: z.string().url().nullable(),
  publishedAt: z.string().datetime().nullable(),
});
export type BriefingItem = z.infer<typeof briefingItemSchema>;

export const briefingSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  title: z.string().min(1),
  summary: z.string().nullable(),
  generatedAt: z.string().datetime(),
  items: z.array(briefingItemSchema),
});
export type Briefing = z.infer<typeof briefingSchema>;

export const actionItemStatusSchema = z.enum([
  "suggested",
  "approved",
  "edited",
  "deferred",
  "dismissed",
  "completed",
]);
export type ActionItemStatus = z.infer<typeof actionItemStatusSchema>;

export const actionItemSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  title: z.string().min(1),
  detail: z.string().nullable(),
  status: actionItemStatusSchema,
  dueAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ActionItem = z.infer<typeof actionItemSchema>;

export const diaryEntrySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  authorUserId: z.string().uuid(),
  kind: z.enum(["text", "voice"]),
  body: z.string().nullable(),
  transcript: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DiaryEntry = z.infer<typeof diaryEntrySchema>;

export const createDiaryEntryInputSchema = z.object({
  body: z.string().trim().min(1).max(20_000),
  kind: z.enum(["text", "voice"]).default("text"),
  audioUri: z.string().url().optional(),
});
export type CreateDiaryEntryInput = z.input<typeof createDiaryEntryInputSchema>;

export const sourceTypeSchema = z.enum([
  "email",
  "ms365_mail",
  "calendar",
  "teams",
  "whatsapp",
  "github",
  "notion",
  "file_upload",
  "obsidian",
  "news",
]);
export type SourceType = z.infer<typeof sourceTypeSchema>;

export const connectedSourceSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  type: sourceTypeSchema,
  displayName: z.string().min(1),
  status: z.enum(["connected", "attention", "disabled", "error"]),
  lastSyncedAt: z.string().datetime().nullable(),
  detail: z.string().nullable(),
});
export type ConnectedSource = z.infer<typeof connectedSourceSchema>;

export const newsCategorySchema = z.enum([
  "world_geopolitics",
  "africa",
  "fintech_payments",
  "crypto_digital_assets",
  "ai_technology",
  "markets_macro",
  "regulatory_compliance",
  "company_competitor",
  "people_monitoring",
  "custom_topics",
]);
export type NewsCategory = z.infer<typeof newsCategorySchema>;

export const newsPreferenceSchema = z.object({
  enabled: z.boolean(),
  briefingEnabled: z.boolean(),
  categories: z.array(newsCategorySchema),
  regions: z.array(z.string()),
  countries: z.array(z.string()),
  keywords: z.array(z.string()),
  peopleToMonitor: z.array(z.string()),
  companiesToMonitor: z.array(z.string()),
  preferredSources: z.array(z.string()),
  blockedSources: z.array(z.string()),
  languages: z.array(z.string()),
  maxItemsPerBriefing: z.number().int().min(1).max(25),
  minRelevanceScore: z.number().min(0).max(1),
});
export type NewsPreference = z.infer<typeof newsPreferenceSchema>;
