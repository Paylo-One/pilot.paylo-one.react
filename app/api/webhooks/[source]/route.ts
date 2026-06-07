/**
 * /api/webhooks/[source] — inbound webhooks (gmail/graph/whatsapp/github/notion).
 * technical-design.md §"API Route Strategy": each webhook is signature-verified
 * and MUST map its payload to a tenant before any work, then enqueue an Inngest
 * event rather than processing inline.
 *
 * Scaffold note: no signature verification, no tenant mapping, no processing.
 * Returns 501 to document the contract without accepting real traffic.
 */

import { NextResponse } from "next/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ source: string }> },
) {
  const { source } = await params;
  return NextResponse.json(
    {
      error: "not_implemented",
      detail: `Webhook handler for "${source}" is a scaffold stub.`,
    },
    { status: 501 },
  );
}
