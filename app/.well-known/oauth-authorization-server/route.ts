import { NextResponse } from "next/server";
import { appHostBaseUrl } from "@/lib/config";
import { ALL_MCP_SCOPES } from "@/modules/mcp";

export async function GET() {
  const issuer = appHostBaseUrl();
  return NextResponse.json({
    issuer,
    authorization_endpoint: `${issuer}/mcp/authorize`,
    token_endpoint: `${issuer}/api/mcp/oauth/token`,
    registration_endpoint: `${issuer}/api/mcp/oauth/register`,
    revocation_endpoint: `${issuer}/api/mcp/oauth/revoke`,
    introspection_endpoint: `${issuer}/api/mcp/oauth/introspect`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256", "plain"],
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
      "none",
    ],
    scopes_supported: ALL_MCP_SCOPES,
  });
}
