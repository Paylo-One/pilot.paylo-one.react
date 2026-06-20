import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertKnownScopes,
  hasScopes,
  parseScopes,
  validateRedirectUri,
  verifyPkce,
  type McpClient,
} from "@/modules/mcp";

function base64url(input: Buffer): string {
  return input
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

const client: McpClient = {
  id: "client-row",
  clientId: "pilot-local-mcp",
  name: "Pilot Local MCP Client",
  description: null,
  clientType: "public",
  redirectUris: ["http://localhost:6274/oauth/callback"],
  allowedScopes: ["memory:read", "actions:read"],
  status: "active",
  createdAt: "2026-06-20T00:00:00.000Z",
};

describe("MCP OAuth helpers", () => {
  it("parses only known scopes and removes duplicates", () => {
    expect(parseScopes("memory:read memory:read unknown actions:read")).toEqual([
      "memory:read",
      "actions:read",
    ]);
  });

  it("rejects unknown scopes for authorisation requests", () => {
    const result = assertKnownScopes(["memory:read", "unknown"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_failed");
    }
  });

  it("checks required scopes with least-privilege matching", () => {
    expect(hasScopes(["memory:read", "actions:read"], ["memory:read"])).toBe(true);
    expect(hasScopes(["memory:read"], ["memory:read", "actions:read"])).toBe(false);
  });

  it("requires an exact registered redirect URI", () => {
    expect(validateRedirectUri(client, "http://localhost:6274/oauth/callback")).toBe(true);
    expect(validateRedirectUri(client, "http://localhost:6274/other")).toBe(false);
  });

  it("verifies S256 PKCE challenges", () => {
    const verifier = "a-long-random-code-verifier";
    const challenge = base64url(createHash("sha256").update(verifier).digest());

    expect(
      verifyPkce({
        codeVerifier: verifier,
        codeChallenge: challenge,
        method: "S256",
      }),
    ).toBe(true);
    expect(
      verifyPkce({
        codeVerifier: "wrong",
        codeChallenge: challenge,
        method: "S256",
      }),
    ).toBe(false);
  });
});
