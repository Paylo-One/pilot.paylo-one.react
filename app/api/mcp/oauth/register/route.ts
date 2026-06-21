import { NextResponse } from "next/server";
import { registerDynamicMcpClient } from "@/modules/mcp";

function registrationError(error: string, description: string, status = 400) {
  return NextResponse.json(
    { error, error_description: description },
    { status },
  );
}

export async function POST(request: Request) {
  const metadata = await request.json().catch(() => null);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return registrationError(
      "invalid_client_metadata",
      "The registration request body must be a JSON object.",
    );
  }

  const result = await registerDynamicMcpClient(
    metadata as Record<string, unknown>,
  );
  if (!result.ok) {
    const status = result.error.code === "internal" ? 500 : 400;
    return registrationError(
      "invalid_client_metadata",
      result.error.message,
      status,
    );
  }

  return NextResponse.json(result.value, { status: 201 });
}
