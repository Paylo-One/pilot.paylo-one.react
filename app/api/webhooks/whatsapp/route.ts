/**
 * /api/webhooks/whatsapp — inbound message push from the WhatsApp bridge (ADR-036).
 *
 * The bridge is the ONLY caller. The request is authenticated two ways (defense
 * in depth): a bearer callback token (constant-time compared) AND an HMAC-SHA256
 * signature over the raw body keyed by that token, so a leaked log line can't be
 * replayed or tampered with. The body carries an explicit tenant_id; ingestion
 * re-checks the active-monitor gate and storage policy server-side
 * (whatsapp-ingest.ts) — the bridge's filtering is never trusted on its own.
 *
 * This route stays static-segment ahead of the generic /api/webhooks/[source]
 * stub, which Next.js resolves in favour of the literal segment.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { whatsappBridgeEnabled, whatsappBridgeCallbackToken } from "@/lib/config";
import { getSessionByTenant } from "@/modules/source-connection/whatsapp-server";
import { ingestWhatsAppMessage } from "@/modules/source-connection/whatsapp-ingest";
import type { BridgeInboundMessage } from "@/modules/source-connection/whatsapp-bridge-client";

const InboundSchema = z.object({
  tenantId: z.string().uuid(),
  chatId: z.string().min(1),
  chatName: z.string().nullable().optional(),
  fromName: z.string().nullable().optional(),
  body: z.string(),
  occurredAt: z.string(),
  providerMessageId: z.string().min(1),
});

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

// Tag every log line so bridge→app delivery is greppable in runtime logs. The
// outcome word makes the failure mode obvious at a glance:
//  - no log at all     → the bridge isn't reaching this route (URL/forwarding)
//  - unauthorized/bad_signature → callback token / HMAC mismatch with the bridge
//  - dropped:no_active_monitor  → message delivered but chat_id ≠ a monitor's
//  - ingested           → working
const TAG = "[whatsapp/webhook]";

export async function POST(request: Request) {
  if (!whatsappBridgeEnabled()) {
    console.warn(`${TAG} rejected: bridge disabled (WHATSAPP_BRIDGE_ENABLED not true)`);
    return NextResponse.json({ error: "bridge_disabled" }, { status: 503 });
  }

  let token: string;
  try {
    token = whatsappBridgeCallbackToken();
  } catch {
    console.error(`${TAG} rejected: bridge misconfigured (WHATSAPP_BRIDGE_CALLBACK_TOKEN not set)`);
    return NextResponse.json({ error: "bridge_misconfigured" }, { status: 500 });
  }

  // Read the raw body once: HMAC must be computed over the exact bytes received.
  const raw = await request.text();

  const presented = bearerToken(request);
  if (!presented || !safeEqual(presented, token)) {
    console.warn(`${TAG} 401 unauthorized: missing/invalid bearer callback token (bridge token ≠ app token)`);
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const signature = request.headers.get("x-paylo-signature") ?? "";
  const expected = `sha256=${createHmac("sha256", token).update(raw).digest("hex")}`;
  if (!safeEqual(signature, expected)) {
    console.warn(`${TAG} 401 bad_signature: HMAC mismatch (callback token differs between bridge and app, or body altered in transit)`);
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  let parsed: BridgeInboundMessage;
  try {
    parsed = InboundSchema.parse(JSON.parse(raw)) as BridgeInboundMessage;
  } catch (err) {
    console.warn(`${TAG} 400 invalid_payload:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  console.log(
    `${TAG} received tenant=${parsed.tenantId} chat=${parsed.chatId} msg=${parsed.providerMessageId}`,
  );

  // The tenant must have a live session row — guards against a stale/forged tenant.
  const session = await getSessionByTenant(parsed.tenantId);
  if (!session) {
    console.warn(`${TAG} 404 no_session for tenant=${parsed.tenantId} — message dropped`);
    return NextResponse.json({ error: "no_session" }, { status: 404 });
  }

  try {
    const result = await ingestWhatsAppMessage(parsed);
    if (result.ingested) {
      console.log(`${TAG} ingested tenant=${parsed.tenantId} chat=${parsed.chatId}`);
    } else {
      // The most common silent failure: chat_id sent by the bridge doesn't match
      // any active monitor's stored chat_id (reason="no_active_monitor").
      console.warn(
        `${TAG} dropped:${result.reason ?? "unknown"} tenant=${parsed.tenantId} chat=${parsed.chatId}`,
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error(
      `${TAG} 500 ingest_failed tenant=${parsed.tenantId} chat=${parsed.chatId}:`,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: "ingest_failed", detail: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
