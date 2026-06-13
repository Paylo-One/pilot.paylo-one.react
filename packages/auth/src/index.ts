import { z } from "zod";

export const authTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable(),
  expiresAt: z.string().datetime().nullable(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const sessionSchema = z.object({
  userId: z.string().uuid(),
  tenantId: z.string().uuid().nullable(),
  tenantSlug: z.string().nullable(),
  tokens: authTokensSchema,
});
export type Session = z.infer<typeof sessionSchema>;

export interface TokenStorage {
  get(): Promise<AuthTokens | null>;
  set(tokens: AuthTokens): Promise<void>;
  clear(): Promise<void>;
}

export interface SessionStorage {
  get(): Promise<Session | null>;
  set(session: Session): Promise<void>;
  clear(): Promise<void>;
}

export function attachAuthHeaders(
  headers: HeadersInit | undefined,
  tokens: AuthTokens | null,
  tenantId?: string | null,
): Headers {
  const result = new Headers(headers);
  if (tokens?.accessToken) {
    result.set("authorization", `Bearer ${tokens.accessToken}`);
  }
  if (tenantId) {
    result.set("x-tenant-id", tenantId);
  }
  return result;
}

export interface SessionController {
  getSession(): Promise<Session | null>;
  setSession(session: Session): Promise<void>;
  clearSession(): Promise<void>;
  refreshSession(): Promise<Session | null>;
}

export function createSessionController(options: {
  storage: SessionStorage;
  refresh?: (session: Session) => Promise<Session | null>;
}): SessionController {
  return {
    getSession: () => options.storage.get(),
    setSession: (session) => options.storage.set(session),
    clearSession: () => options.storage.clear(),
    async refreshSession() {
      const current = await options.storage.get();
      if (!current || !options.refresh) return current;
      const next = await options.refresh(current);
      if (next) await options.storage.set(next);
      else await options.storage.clear();
      return next;
    },
  };
}

export function createMemorySessionStorage(): SessionStorage {
  let value: Session | null = null;
  return {
    async get() {
      return value;
    },
    async set(session) {
      value = session;
    },
    async clear() {
      value = null;
    },
  };
}
