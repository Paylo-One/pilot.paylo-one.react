import { NextResponse } from "next/server";
import { revokeTokenOrGrant } from "@/modules/mcp";

function clientCredentials(form: URLSearchParams, request: Request) {
  const basic = request.headers.get("authorization")?.match(/^Basic\s+(.+)$/i)?.[1];
  if (basic) {
    const [clientId = "", clientSecret = ""] = Buffer.from(basic, "base64")
      .toString("utf8")
      .split(":");
    return { clientId, clientSecret };
  }
  return {
    clientId: form.get("client_id") ?? "",
    clientSecret: form.get("client_secret"),
  };
}

export async function POST(request: Request) {
  const form = new URLSearchParams(await request.text());
  const { clientId, clientSecret } = clientCredentials(form, request);
  const result = await revokeTokenOrGrant({
    token: form.get("token") ?? "",
    tokenTypeHint: form.get("token_type_hint"),
    clientId,
    clientSecret,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: "invalid_request", error_description: result.error.message },
      { status: 400 },
    );
  }
  return new NextResponse(null, { status: 200 });
}
