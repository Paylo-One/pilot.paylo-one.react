import { NextResponse } from "next/server";
import { introspectToken } from "@/modules/mcp";

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
  const result = await introspectToken({
    token: form.get("token") ?? "",
    clientId,
    clientSecret,
  });
  if (!result.ok) {
    return NextResponse.json({ active: false }, { status: 200 });
  }
  return NextResponse.json(result.value);
}
