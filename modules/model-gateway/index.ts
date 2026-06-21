/**
 * modules/model-gateway — the Paylo Model Gateway: the single, tenant-aware
 * front door to all inference. Every agent, workflow, and feature reaches a
 * model through here; nothing above the Gateway ever calls a provider or vLLM
 * directly (architecture/model-inference-architecture.md §1–§2).
 *
 * This barrel is the module's public surface. Sibling modules import the
 * Gateway's shared types (e.g. `DataClassification`, `ModelPolicy`) from here
 * via type-only imports; callers use the `modelGateway` service.
 *
 * Composition: the Gateway orchestrates its sibling services — Model Catalogue
 * (routing metadata), Model Entitlement (deny-by-default access), Prompt
 * Versioning (reproducible prompts), and Model Usage & Cost (metering) — behind
 * the `policy → assembly → route → post-process` pipeline.
 *
 * MVP status: the default `modelGateway` runs a live pipeline against the
 * hosted OpenAI adapter for completions and embeddings. It still enforces
 * policy/entitlement for completions and meters usage on every call.
 */

export * from "./types";
export * from "./adapters";
export * from "./pipeline";
export * from "./live-pipeline";
export * from "./service";
