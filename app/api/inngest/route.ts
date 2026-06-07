/**
 * /api/inngest — the single endpoint the workflow engine calls
 * (technical-design.md §"Background Job Strategy", workflow-orchestration.md).
 * All durable/async work (scheduled Daily Memo fan-out, sync jobs, file/voice
 * processing, embeddings, agent runs) is served here. Every job payload carries
 * `tenantId` and re-establishes tenant context as its first step.
 *
 * Scaffold note: Inngest is not wired. This returns a descriptive 501 so the
 * route exists and documents the contract.
 */

import { NextResponse } from "next/server";

function notWired() {
  return NextResponse.json(
    { error: "not_implemented", detail: "Inngest is not wired in the scaffold." },
    { status: 501 },
  );
}

export const GET = notWired;
export const POST = notWired;
export const PUT = notWired;
