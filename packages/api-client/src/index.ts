import { attachAuthHeaders, type AuthTokens } from "@management-os/auth";
import {
  actionItemSchema,
  briefingItemSchema,
  briefingSchema,
  connectedSourceSchema,
  createDiaryEntryInputSchema,
  diaryEntrySchema,
  type ActionItemStatus,
  type BriefingFeedback,
  type BriefingItemStatus,
  type CreateDiaryEntryInput,
} from "@management-os/domain";
import { z, type ZodType } from "zod";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getTokens?: () => Promise<AuthTokens | null>;
  getTenantId?: () => Promise<string | null> | string | null;
  fetchImpl?: typeof fetch;
}

export const queryKeys = {
  briefing: {
    all: ["briefing"] as const,
    today: () => ["briefing", "today"] as const,
    item: (id: string) => ["briefing", "item", id] as const,
  },
  actions: {
    all: ["actions"] as const,
  },
  sources: {
    all: ["connected-sources"] as const,
    status: () => ["connected-sources", "status"] as const,
  },
} as const;

function joinUrl(baseUrl: string, path: string): string {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function responseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/json")
    ? response.json()
    : response.text();
}

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(
    path: string,
    init: RequestInit,
    schema: ZodType<T>,
  ): Promise<T> {
    const [tokens, tenantId] = await Promise.all([
      options.getTokens?.() ?? null,
      options.getTenantId?.() ?? null,
    ]);
    const headers = attachAuthHeaders(init.headers, tokens, tenantId);
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetchImpl(joinUrl(options.baseUrl, path), {
      ...init,
      headers,
    });
    const body = await responseBody(response);
    if (!response.ok) {
      const payload =
        body && typeof body === "object"
          ? (body as Record<string, unknown>)
          : undefined;
      throw new ApiError(
        typeof payload?.message === "string"
          ? payload.message
          : `Request failed with status ${response.status}.`,
        response.status,
        typeof payload?.code === "string" ? payload.code : undefined,
        body,
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        "The API returned an unexpected response.",
        response.status,
        "invalid_response",
        parsed.error.flatten(),
      );
    }
    return parsed.data;
  }

  return {
    getTodayBriefing: () =>
      request("/api/v1/briefings/today", { method: "GET" }, briefingSchema),
    getBriefingItem: (id: string) =>
      request(
        `/api/v1/briefing-items/${encodeURIComponent(id)}`,
        { method: "GET" },
        briefingItemSchema,
      ),
    updateBriefingItemStatus: (id: string, status: BriefingItemStatus) =>
      request(
        `/api/v1/briefing-items/${encodeURIComponent(id)}/status`,
        { method: "PATCH", body: JSON.stringify({ status }) },
        briefingItemSchema,
      ),
    submitBriefingFeedback: (id: string, feedback: BriefingFeedback) =>
      request(
        `/api/v1/briefing-items/${encodeURIComponent(id)}/feedback`,
        { method: "POST", body: JSON.stringify({ feedback }) },
        z.object({ accepted: z.literal(true) }),
      ),
    getActions: () =>
      request("/api/v1/actions", { method: "GET" }, z.array(actionItemSchema)),
    updateActionStatus: (id: string, status: ActionItemStatus) =>
      request(
        `/api/v1/actions/${encodeURIComponent(id)}/status`,
        { method: "PATCH", body: JSON.stringify({ status }) },
        actionItemSchema,
      ),
    createDiaryEntry: (input: CreateDiaryEntryInput) => {
      const payload = createDiaryEntryInputSchema.parse(input);
      return request(
        "/api/v1/diary",
        { method: "POST", body: JSON.stringify(payload) },
        diaryEntrySchema,
      );
    },
    getConnectedSourcesStatus: () =>
      request(
        "/api/v1/connected-sources/status",
        { method: "GET" },
        z.array(connectedSourceSchema),
      ),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
