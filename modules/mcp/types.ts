import type { TenantContext } from "@/modules/shared";

export const MCP_SCOPES = {
  "memory:read": "Read workspace memory, summaries, and contextual knowledge.",
  "actions:read": "Read actions, follow-ups, deadlines, and status.",
  "actions:write": "Create or update actions with explicit permission.",
  "diary:read": "Read your private diary entries and weekly reflections.",
  "diary:write": "Create private diary entries or reflections.",
  "briefings:read": "Read generated briefings and briefing history.",
  "sources:read": "Read source metadata and citation references.",
  "people:read": "Read people and relationship context linked to memory.",
  "risks:read": "Read unresolved risks and risk history.",
  "decisions:read": "Read decisions and decision history.",
} as const;

export type McpScope = keyof typeof MCP_SCOPES;

export const ALL_MCP_SCOPES = Object.keys(MCP_SCOPES) as McpScope[];

export interface McpClient {
  readonly id: string;
  readonly clientId: string;
  readonly name: string;
  readonly description: string | null;
  readonly clientType: "public" | "confidential";
  readonly redirectUris: string[];
  readonly allowedScopes: McpScope[];
  readonly status: "active" | "revoked";
  readonly createdAt: string;
}

export interface McpGrant {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly client: McpClient;
  readonly scopes: McpScope[];
  readonly status: "active" | "revoked";
  readonly grantedAt: string;
  readonly revokedAt: string | null;
  readonly lastUsedAt: string | null;
  readonly refreshTokenExpiresAt: string | null;
}

export interface McpAuthContext extends TenantContext {
  readonly grantId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly scopes: McpScope[];
  readonly accessTokenId: string;
}

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly requiredScopes: readonly McpScope[];
  readonly inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  readonly content: unknown;
  readonly citations?: unknown[];
}
