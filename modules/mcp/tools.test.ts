import { describe, expect, it } from "vitest";
import { callMcpTool, getMcpToolDefinition, listMcpTools } from "@/modules/mcp";

describe("MCP tool catalogue", () => {
  it("returns only tools covered by the granted scopes", () => {
    const tools = listMcpTools(["memory:read"]).map((tool) => tool.name);

    expect(tools).toContain("search_memory");
    expect(tools).toContain("get_context");
    expect(tools).not.toContain("create_action");
    expect(tools).not.toContain("search_diary");
  });

  it("exposes company + relationship-graph tools under people:read", () => {
    const tools = listMcpTools(["people:read"]).map((tool) => tool.name);
    expect(tools).toContain("list_companies");
    expect(tools).toContain("get_company_context");
    expect(tools).toContain("get_relationship_graph");
    const memoryOnly = listMcpTools(["memory:read"]).map((tool) => tool.name);
    expect(memoryOnly).not.toContain("list_companies");
    expect(memoryOnly).not.toContain("get_relationship_graph");
  });

  it("documents required scopes for write-capable tools", () => {
    expect(getMcpToolDefinition("create_action")?.requiredScopes).toEqual([
      "actions:write",
    ]);
    expect(getMcpToolDefinition("create_diary_entry")?.requiredScopes).toEqual([
      "diary:write",
    ]);
  });

  it("denies unknown tools before execution", async () => {
    const result = await callMcpTool(
      {
        tenantId: "tenant",
        tenantSlug: "tenant",
        userId: "user",
        role: "member",
        grantId: "grant",
        clientId: "client",
        clientName: "Client",
        scopes: ["memory:read"],
        accessTokenId: "token",
      },
      "raw_sql",
      {},
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_failed");
    }
  });
});
