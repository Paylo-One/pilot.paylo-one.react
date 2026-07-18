/**
 * /api/inngest — the single endpoint the workflow engine calls
 * (technical-design.md §"Background Job Strategy", workflow-orchestration.md).
 * All durable/async work (scheduled Daily Memo fan-out, sync jobs, file/voice
 * processing, embeddings, agent runs) is served here. Every job payload carries
 * `tenantId` and re-establishes tenant context as its first step.
 */

import { serve } from "inngest/next";
import { appHostBaseUrl } from "@/lib/config";
import {
  inngest,
  briefingGenerateFunction,
  newsIngestDispatchFunction,
  newsIngestFunction,
  sourceSyncFunction,
  schedulerDispatchFunction,
  intelligenceProcessFunction,
  operatingReviewDispatchFunction,
  operatingReviewFunction,
} from "@/lib/inngest";

// Pin the URL Inngest registers to the reserved, tenant-neutral `app.` host
// (e.g. https://app.paylo.one). Without this, the Vercel↔Inngest integration
// syncs the per-deployment *.vercel.app URL — which is behind Deployment
// Protection AND an unknown host to our tenant routing, so Inngest "could not
// reach your URL". Inngest is shared infra (each job payload carries its own
// tenantId), so it must NOT be bound to a tenant subdomain.
export const { GET, POST, PUT } = serve({
  client: inngest,
  serveOrigin: appHostBaseUrl(),
  servePath: "/api/inngest",
  functions: [
    briefingGenerateFunction,
    newsIngestDispatchFunction,
    newsIngestFunction,
    sourceSyncFunction,
    schedulerDispatchFunction,
    intelligenceProcessFunction,
    operatingReviewDispatchFunction,
    operatingReviewFunction,
  ],
});
