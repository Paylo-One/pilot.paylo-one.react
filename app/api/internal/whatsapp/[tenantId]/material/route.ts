/**
 * /api/internal/whatsapp/[tenantId]/material — durable home for a tenant's
 * encrypted WhatsApp session material (ADR-036). The bridge persists its
 * encrypted auth-state blob here (PUT) and restores it on cold start (GET) so
 * the bridge runtime can stay stateless/restartable while the crown-jewel
 * material lives in the app's server-only, default-deny store.
 *
 * The blob is OPAQUE ciphertext: the app never holds the key (it lives only on
 * the bridge), so this route reads/writes bytes it cannot decrypt. The bridge is
 * the only caller — authenticated by the callback token (bearer + HMAC over the
 * body on PUT). Internal-only; never linked from the workspace.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { whatsappBridgeEnabled, whatsappBridgeCallbackToken } from "@/lib/config";
import {
  getSessionByTenant,
  getSessionMaterial,
  storeSessionMaterial,
} from "@/modules/source-connection/whatsapp-server";

const MaterialSchema = z.object({
  ciphertext: z.string().min(1),
  keyVersion: z.number().int().positive().default(1),
});

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function authorize(req: Request, token: string, raw?: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!presented || !safeEqual(presented, token)) return false;
  if (raw !== undefined) {
    const sig = req.headers.get("x-paylo-signature") ?? "";
    const expected = `sha256=${createHmac("sha256", token).update(raw).digest("hex")}`;
    if (!safeEqual(sig, expected)) return false;
  }
  return true;
}

function guard(): { token: string } | NextResponse {
  if (!whatsappBridgeEnabled()) {
    return NextResponse.json({ error: "bridge_disabled" }, { status: 503 });
  }
  try {
    return { token: whatsappBridgeCallbackToken() };
  } catch {
    return NextResponse.json({ error: "bridge_misconfigured" }, { status: 500 });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const g = guard();
  if (g instanceof NextResponse) return g;
  if (!authorize(request, g.token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { tenantId } = await params;
  const material = await getSessionMaterial(tenantId);
  if (!material) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(material);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const g = guard();
  if (g instanceof NextResponse) return g;

  const raw = await request.text();
  if (!authorize(request, g.token, raw)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { tenantId } = await params;
  const session = await getSessionByTenant(tenantId);
  if (!session) return NextResponse.json({ error: "no_session" }, { status: 404 });

  let body: z.infer<typeof MaterialSchema>;
  try {
    body = MaterialSchema.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  await storeSessionMaterial(tenantId, session.id, body.ciphertext, body.keyVersion);
  return NextResponse.json({ ok: true });
}
