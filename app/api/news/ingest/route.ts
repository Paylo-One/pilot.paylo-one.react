import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { runNewsIngestion } from "@/modules/news/ingest";
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
  const runs = [];
  for (const tenantId of tenantIds) {
    try {
      runs.push({ tenantId, ok: true, result: await runNewsIngestion(tenantId) });
    } catch (cause) {
      runs.push({
        tenantId,
        ok: false,
        error: cause instanceof Error ? cause.message : "ingestion_failed",
      });
    }
  }
  return NextResponse.json({ runs });
}
