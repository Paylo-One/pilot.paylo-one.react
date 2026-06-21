import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { insertMock } = vi.hoisted(() => ({
  insertMock: vi.fn(),
}));

vi.mock("@/lib/supabase/secret", () => ({
  createSupabaseSecretClient: () => ({
    from: () => ({
      insert: insertMock,
    }),
  }),
}));

import {
  ALL_MCP_SCOPES,
  assertKnownScopes,
  hasScopes,
  parseScopes,
  registerDynamicMcpClient,
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
  beforeEach(() => {
    insertMock.mockReset();
    insertMock.mockResolvedValue({ error: null });
  });

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

  it("registers public dynamic MCP clients with their callback URI and requested scopes", async () => {
    const result = await registerDynamicMcpClient({
      redirect_uris: ["http://127.0.0.1:6274/oauth/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "Claude",
      scope: "memory:read actions:read",
    });

    expect(result.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client_type: "public",
        name: "Claude",
        redirect_uris: ["http://127.0.0.1:6274/oauth/callback"],
        allowed_scopes: ["memory:read", "actions:read"],
      }),
    );
    if (result.ok) {
      expect(result.value.client_id).toMatch(/^plo_mcp_client_/);
      expect(result.value.scope).toBe("memory:read actions:read");
      expect(result.value.token_endpoint_auth_method).toBe("none");
    }
  });

  it("defaults dynamic clients to the supported Pilot MCP scopes when no scope is supplied", async () => {
    const result = await registerDynamicMcpClient({
      redirect_uris: ["http://localhost:3334/oauth/callback"],
      token_endpoint_auth_method: "none",
      client_name: "Warp",
    });

    expect(result.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowed_scopes: ALL_MCP_SCOPES,
      }),
    );
  });

  it("rejects dynamic clients with unsafe redirect URIs", async () => {
    const result = await registerDynamicMcpClient({
      redirect_uris: ["http://example.com/oauth/callback"],
      token_endpoint_auth_method: "none",
      client_name: "Unsafe Client",
    });

    expect(result.ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
