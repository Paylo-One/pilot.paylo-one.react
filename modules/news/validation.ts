import { z } from "zod";
import { NEWS_CATEGORY_ORDER } from "./index";

const trimmedList = z
  .array(z.string().trim().min(1).max(240))
  .max(100)
  .transform((values) => [...new Set(values)]);

export const NewsCategorySchema = z.enum(NEWS_CATEGORY_ORDER as [
  (typeof NEWS_CATEGORY_ORDER)[number],
  ...(typeof NEWS_CATEGORY_ORDER)[number][],
]);

export const NewsPreferencesPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    briefingEnabled: z.boolean().optional(),
    categories: z.array(NewsCategorySchema).max(10).optional(),
    regions: trimmedList.optional(),
    countries: trimmedList.optional(),
    keywords: trimmedList.optional(),
    peopleToMonitor: trimmedList.optional(),
    companiesToMonitor: trimmedList.optional(),
    preferredSources: trimmedList.optional(),
    blockedSources: trimmedList.optional(),
    languages: z.array(z.string().trim().min(2).max(12)).max(20).optional(),
    maxItemsPerBriefing: z.number().int().min(1).max(25).optional(),
    minRelevanceScore: z.number().min(0).max(1).optional(),
    includeGlobalHeadlines: z.boolean().optional(),
    includeMarketNews: z.boolean().optional(),
    includeRegulatoryNews: z.boolean().optional(),
    includeAiNews: z.boolean().optional(),
  })
  .strict();

export const NewsProviderConfigSchema = z
  .object({
    providerKey: z.string().trim().min(1).max(80),
    enabled: z.boolean().optional(),
    feedUrls: z.array(z.string().url().max(2048)).max(20).optional(),
  })
  .strict();

export const NewsFeedbackSchema = z
  .object({
    newsItemId: z.string().uuid(),
    signal: z.enum([
      "more_like_this",
      "less_like_this",
      "hide_source",
      "follow_topic",
      "unfollow_topic",
      "important",
      "not_relevant",
    ]),
    topic: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
