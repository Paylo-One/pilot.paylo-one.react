import "server-only";

import OpenAI from "openai";
import { AppError } from "@/modules/shared";

/**
 * lib/llm.ts — resolves the active LLM provider for all server-side inference.
 *
 * Pilot reaches models through an OpenAI-compatible API. Pointing the base URL
 * at an EU router (Requesty, hosted in Frankfurt) and selecting EU-hosted models
 * (e.g. Mistral) keeps every prompt and completion inside the EU with zero
 * retention — the data-residency posture behind the product's "processed in the
 * EU" promise (ADR-045; governance security-and-privacy.md).
 *
 * This is a drop-in, flag-driven switch, NOT a hard cutover: with no EU base URL
 * configured the same code path talks to hosted OpenAI exactly as before, so the
 * provider can be A/B'd per environment. All three inference entry points route
 * through here — the Model Gateway adapter (Daily Memo), inline action metadata
 * extraction, and the Diary weekly summary + voice transcription.
 *
 * Secrets stay server-side: the resolved key is never logged or returned.
 */

/**
 * OpenAI-compatible base URL for the active provider, or undefined for hosted
 * OpenAI. Set to the EU router (e.g. https://router.eu.requesty.ai/v1) to keep
 * inference in-region.
 */
export function llmBaseUrl(): string | undefined {
  return process.env.LLM_BASE_URL?.trim() || undefined;
}

/**
 * True when inference is pinned to an EU-resident router. Drives factual,
 * customer-facing data-residency copy — only asserted when an EU endpoint is
 * actually configured, never hard-coded.
 */
export function isEuInference(): boolean {
  const url = llmBaseUrl();
  return !!url && /\brouter\.eu\.requesty\.ai\b/i.test(url);
}

/** Human-readable provider label for audit/metering and internal surfaces. */
export function llmProviderLabel(): string {
  if (isEuInference()) return "EU (Frankfurt) · OpenAI-compatible router";
  return llmBaseUrl() ? "OpenAI-compatible router" : "OpenAI (hosted)";
}

/**
 * Resolve the server LLM key. Prefers the EU router key when set, else the
 * hosted-OpenAI key. An explicit override (tenant BYO key, ADR-038) wins.
 */
export function llmApiKey(overrideKey?: string): string | undefined {
  return (
    overrideKey?.trim() ||
    process.env.LLM_API_KEY?.trim() ||
    process.env.REQUESTY_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    undefined
  );
}

/** True when any LLM key is configured (guards graceful heuristic fallbacks). */
export function hasLlm(overrideKey?: string): boolean {
  return !!llmApiKey(overrideKey);
}

/**
 * Chat/completion model id for the active provider. Must be a valid id for that
 * provider — an EU router uses provider-prefixed ids (e.g.
 * "mistral/mistral-small-latest"); hosted OpenAI uses "gpt-4o-mini".
 */
export function llmChatModel(): string {
  return (
    process.env.LLM_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-4o-mini"
  );
}

/**
 * Embedding model id for the active provider. Requesty requires the provider
 * prefix even for OpenAI models; hosted OpenAI expects the bare model id.
 */
export function llmEmbeddingModel(): string {
  const configured = process.env.LLM_EMBEDDING_MODEL?.trim();
  if (configured) return configured;
  return isEuInference()
    ? "openai/text-embedding-3-small"
    : "text-embedding-3-small";
}

/** Transcription model id for the active provider (Diary voice notes). */
export function llmTranscriptionModel(): string {
  return (
    process.env.LLM_TRANSCRIPTION_MODEL?.trim() ||
    process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() ||
    "whisper-1"
  );
}

/**
 * Build an OpenAI-SDK client pointed at the active provider. When an EU base URL
 * is configured the SDK talks to the EU router; otherwise hosted OpenAI. The key
 * stays server-side.
 */
export function createLlmClient(overrideKey?: string): OpenAI {
  const apiKey = llmApiKey(overrideKey);
  if (!apiKey) {
    throw new AppError(
      "internal",
      "No LLM API key configured (set LLM_API_KEY / REQUESTY_API_KEY or OPENAI_API_KEY)",
    );
  }
  const baseURL = llmBaseUrl();
  return new OpenAI(baseURL ? { apiKey, baseURL } : { apiKey });
}
