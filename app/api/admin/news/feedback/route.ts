import { NextResponse } from "next/server";
import { recordNewsFeedback } from "@/modules/news/server";
import { requireApiTenantContext } from "../_context";

export async function POST(request: Request) {
  const ctx = await requireApiTenantContext();
  if (ctx instanceof NextResponse) return ctx;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const result = await recordNewsFeedback(ctx, body);
  return result.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json(
        { error: result.error.code, detail: result.error.message },
        { status: 400 },
      );
}
