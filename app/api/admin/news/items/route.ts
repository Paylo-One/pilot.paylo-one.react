import { NextResponse } from "next/server";
import { listNewsItems } from "@/modules/news/server";
import { requireApiTenantContext } from "../_context";

export async function GET(request: Request) {
  const ctx = await requireApiTenantContext();
  if (ctx instanceof NextResponse) return ctx;
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "30");
  return NextResponse.json({
    items: await listNewsItems(ctx, Number.isFinite(limit) ? limit : 30),
  });
}
