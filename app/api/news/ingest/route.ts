import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueNewsIngestions } from "@/lib/inngest";
import { listEnabledNewsTenantIds } from "@/modules/news/server";

const PayloadSchema = z.object({ tenantId: z.string().uuid().optional() }).strict();

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.NEWS_INGESTION_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json(
      { error: "news_ingestion_not_configured" },
      { status: 503 },
    );
  }
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!presented || !safeEqual(presented, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let parsed: z.infer<typeof PayloadSchema>;
  try {
    const text = await request.text();
    parsed = PayloadSchema.parse(text ? JSON.parse(text) : {});
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const tenantIds = parsed.tenantId
    ? [parsed.tenantId]
    : await listEnabledNewsTenantIds();
  try {
    const eventIds = await enqueueNewsIngestions(tenantIds, "internal");
    return NextResponse.json(
      { queued: tenantIds, eventIds },
      { status: 202 },
    );
  } catch (cause) {
    console.error("[news/ingest-api] failed to enqueue ingestion", cause);
    return NextResponse.json(
      { error: "news_ingestion_enqueue_failed" },
      { status: 500 },
    );
  }
}
