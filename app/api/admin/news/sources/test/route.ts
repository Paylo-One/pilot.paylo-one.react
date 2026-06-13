import { NextResponse } from "next/server";
import { testNewsProvider } from "@/modules/news/server";
import { requireApiTenantContext } from "../../_context";

export async function POST(request: Request) {
  const ctx = await requireApiTenantContext();
  if (ctx instanceof NextResponse) return ctx;
  let body: { providerKey?: unknown };
  try {
    body = (await request.json()) as { providerKey?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.providerKey !== "string") {
    return NextResponse.json({ error: "provider_key_required" }, { status: 400 });
  }
  const result = await testNewsProvider(ctx, body.providerKey);
  return result.ok
    ? NextResponse.json(result.value)
    : NextResponse.json(
        { error: result.error.code, detail: result.error.message },
        { status: 400 },
      );
}
