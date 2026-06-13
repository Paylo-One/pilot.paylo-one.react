import { NextResponse } from "next/server";
import { listNewsProviders } from "@/modules/news/server";
import { requireApiTenantContext } from "../_context";

export async function GET() {
  const ctx = await requireApiTenantContext();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ providers: await listNewsProviders(ctx) });
}
