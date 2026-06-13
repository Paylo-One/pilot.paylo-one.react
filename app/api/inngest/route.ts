/**
 * /api/inngest — the single endpoint the workflow engine calls
 * (technical-design.md §"Background Job Strategy", workflow-orchestration.md).
 * All durable/async work (scheduled Daily Memo fan-out, sync jobs, file/voice
 * processing, embeddings, agent runs) is served here. Every job payload carries
 * `tenantId` and re-establishes tenant context as its first step.
 */

import { serve } from "inngest/next";
import { inngest, briefingGenerateFunction, newsIngestFunction } from "@/lib/inngest";

// Export the GET, POST, and PUT handlers to route requests to Inngest
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    briefingGenerateFunction,
    newsIngestFunction,
  ],
});
