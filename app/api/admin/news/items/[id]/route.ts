import { NextResponse } from "next/server";
import { getNewsItem } from "@/modules/news/server";
import { requireApiTenantContext } from "../../_context";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireApiTenantContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const item = await getNewsItem(ctx, id);
  return item
    ? NextResponse.json({ item })
    : NextResponse.json({ error: "not_found" }, { status: 404 });
}
