import { NextResponse } from "next/server";
import { buildExternalSignals } from "@/modules/news/briefing";
import { requireApiTenantContext } from "../_context";

export async function POST() {
  const ctx = await requireApiTenantContext();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ items: await buildExternalSignals(ctx) });
}
