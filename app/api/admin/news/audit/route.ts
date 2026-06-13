import { NextResponse } from "next/server";
import { listNewsAudit } from "@/modules/news/server";
import { requireApiTenantContext } from "../_context";

export async function GET(request: Request) {
  const ctx = await requireApiTenantContext();
  if (ctx instanceof NextResponse) return ctx;
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "20");
  return NextResponse.json({
    audit: await listNewsAudit(ctx, Number.isFinite(limit) ? limit : 20),
  });
}
