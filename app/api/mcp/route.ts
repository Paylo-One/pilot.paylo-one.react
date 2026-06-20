import { NextResponse } from "next/server";
import { callMcpTool, listMcpTools, validateBearerToken } from "@/modules/mcp";

function jsonRpc(id: unknown, result: unknown, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id, result }, { status });
}

function jsonRpcError(id: unknown, code: number, message: string, status = 400) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status },
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const id = body?.id ?? null;
  const method = String(body?.method ?? "");
  const auth = await validateBearerToken(request.headers.get("authorization"));

  if (!auth.ok) {
    return jsonRpcError(id, -32001, auth.error.message, 401);
  }

  if (method === "initialize") {
    return jsonRpc(id, {
      protocolVersion: "2025-03-26",
      serverInfo: { name: "Pilot Workspace Memory", version: "1.0.0" },
      capabilities: { tools: {} },
    });
  }

  if (method === "tools/list") {
    return jsonRpc(id, {
      tools: listMcpTools(auth.value.scopes).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    });
  }

  if (method === "tools/call") {
    const name = String(body?.params?.name ?? "");
    const args = body?.params?.arguments ?? {};
    const result = await callMcpTool(auth.value, name, args);
    if (!result.ok) {
      const status = result.error.code === "policy_denied" ? 403 : 400;
      return jsonRpcError(id, -32002, result.error.message, status);
    }
    return jsonRpc(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.value, null, 2),
        },
      ],
      structuredContent: result.value,
    });
  }

  return jsonRpcError(id, -32601, "Unknown MCP method.");
}
