import { NextResponse } from "next/server";
import {
  resolveTenantContext,
} from "@/modules/identity-tenant/server";
import type { TenantContext } from "@/modules/shared";

export async function requireApiTenantContext(): Promise<
  TenantContext | NextResponse
> {
  const resolution = await resolveTenantContext();
  if (resolution.kind === "ok") return resolution.context;
  if (resolution.kind === "unauthenticated") {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  return NextResponse.json({ error: "tenant_context_required" }, { status: 403 });
}
