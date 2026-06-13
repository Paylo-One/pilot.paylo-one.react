import { NextResponse } from "next/server";
import { getNewsPreferences, updateNewsPreferences } from "@/modules/news/preferences";
import { requireApiTenantContext } from "../_context";

export async function GET() {
  const ctx = await requireApiTenantContext();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ preferences: await getNewsPreferences(ctx) });
}

export async function PUT(request: Request) {
  const ctx = await requireApiTenantContext();
  if (ctx instanceof NextResponse) return ctx;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const result = await updateNewsPreferences(ctx, body as never);
  return result.ok
    ? NextResponse.json({ preferences: result.value })
    : NextResponse.json(
        { error: result.error.code, detail: result.error.message },
        { status: result.error.code === "validation_failed" ? 400 : 500 },
      );
}
