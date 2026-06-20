import { NextResponse } from "next/server";
import {
  exchangeAuthorizationCode,
  rotateRefreshToken,
} from "@/modules/mcp";

function clientCredentials(form: URLSearchParams, request: Request) {
  const basic = request.headers.get("authorization")?.match(/^Basic\s+(.+)$/i)?.[1];
  if (basic) {
    const decoded = Buffer.from(basic, "base64").toString("utf8");
    const [clientId, clientSecret] = decoded.split(":");
    return {
      clientId: decodeURIComponent(clientId ?? ""),
      clientSecret: decodeURIComponent(clientSecret ?? ""),
    };
  }
  return {
    clientId: form.get("client_id") ?? "",
    clientSecret: form.get("client_secret"),
  };
}

function oauthError(error: string, description: string, status = 400) {
  return NextResponse.json(
    { error, error_description: description },
    { status },
  );
}

export async function POST(request: Request) {
  const form = new URLSearchParams(await request.text());
  const grantType = form.get("grant_type");
  const { clientId, clientSecret } = clientCredentials(form, request);

  if (grantType === "authorization_code") {
    const result = await exchangeAuthorizationCode({
      code: form.get("code") ?? "",
      clientId,
      clientSecret,
      redirectUri: form.get("redirect_uri") ?? "",
      codeVerifier: form.get("code_verifier") ?? "",
    });
    if (!result.ok) return oauthError("invalid_grant", result.error.message, 400);
    return NextResponse.json(result.value);
  }

  if (grantType === "refresh_token") {
    const result = await rotateRefreshToken({
      refreshToken: form.get("refresh_token") ?? "",
      clientId,
      clientSecret,
    });
    if (!result.ok) return oauthError("invalid_grant", result.error.message, 400);
    return NextResponse.json(result.value);
  }

  return oauthError("unsupported_grant_type", "Pilot MCP supports authorization_code and refresh_token.");
}
