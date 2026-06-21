import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import {
  AppError,
  PolicyDeniedError,
  ValidationError,
  type Result,
  err,
  ok,
  type TenantContext,
} from "@/modules/shared";
import {
  ALL_MCP_SCOPES,
  MCP_SCOPES,
  type McpAuthContext,
  type McpClient,
  type McpGrant,
  type McpScope,
} from "./types";

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_DAYS = 30;
const AUTHORISATION_CODE_TTL_MINUTES = 10;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createOpaqueToken(prefix: string): string {
  return `${prefix}_${base64url(randomBytes(32))}`;
}

export function parseScopes(raw: string | null | undefined): McpScope[] {
  const requested = (raw ?? "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  const unique = [...new Set(requested)];
  return unique.filter((scope): scope is McpScope =>
    (ALL_MCP_SCOPES as readonly string[]).includes(scope),
  );
}

export function assertKnownScopes(scopes: readonly string[]): Result<McpScope[]> {
  const unknown = scopes.filter(
    (scope) => !(ALL_MCP_SCOPES as readonly string[]).includes(scope),
  );
  if (unknown.length > 0) {
    return err(
      new ValidationError("One or more requested MCP scopes are not recognised.", {
        scopes: unknown,
      }),
    );
  }
  return ok([...new Set(scopes)] as McpScope[]);
}

export function hasScopes(
  granted: readonly McpScope[],
  required: readonly McpScope[],
): boolean {
  return required.every((scope) => granted.includes(scope));
}

export function validateRedirectUri(client: McpClient, redirectUri: string): boolean {
  return client.redirectUris.includes(redirectUri);
}

export function verifyPkce(input: {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly method: string | null;
}): boolean {
  const method = input.method ?? "plain";
  const actual =
    method === "S256"
      ? base64url(createHash("sha256").update(input.codeVerifier).digest())
      : input.codeVerifier;
  return actual === input.codeChallenge;
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function mapClient(row: any): McpClient {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    description: row.description,
    clientType: row.client_type,
    redirectUris: row.redirect_uris ?? [],
    allowedScopes: row.allowed_scopes ?? [],
    status: row.status,
    createdAt: row.created_at,
  };
}

function registrationError(message: string, detail?: Record<string, unknown>) {
  return new ValidationError(message, detail);
}

function normaliseClientName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  return name.slice(0, 120) || "MCP Client";
}

function validateDynamicRedirectUris(value: unknown): Result<string[]> {
  if (!Array.isArray(value) || value.length === 0) {
    return err(registrationError("Dynamic MCP clients must provide redirect_uris."));
  }
  if (value.length > 10) {
    return err(registrationError("Dynamic MCP clients may register up to 10 redirect URIs."));
  }

  const redirectUris: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return err(registrationError("Every redirect URI must be a string."));
    }
    let url: URL;
    try {
      url = new URL(item);
    } catch {
      return err(registrationError("Every redirect URI must be a valid URL."));
    }
    const isLocalhost =
      url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(isLocalhost && url.protocol === "http:")) {
      return err(
        registrationError(
          "Redirect URIs must use HTTPS, except localhost development callbacks.",
        ),
      );
    }
    if (url.hash) {
      return err(registrationError("Redirect URIs must not include fragments."));
    }
    redirectUris.push(url.toString());
  }
  return ok([...new Set(redirectUris)]);
}

async function getClientByClientId(clientId: string): Promise<McpClient | null> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("mcp_oauth_clients")
    .select(
      "id, client_id, name, description, client_type, redirect_uris, allowed_scopes, status, created_at",
    )
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapClient(data) : null;
}

export interface DynamicClientRegistrationResponse {
  readonly client_id: string;
  readonly client_id_issued_at: number;
  readonly client_secret_expires_at: 0;
  readonly redirect_uris: readonly string[];
  readonly token_endpoint_auth_method: "none";
  readonly grant_types: readonly ["authorization_code", "refresh_token"];
  readonly response_types: readonly ["code"];
  readonly client_name: string;
  readonly client_uri?: string;
  readonly scope: string;
}

export async function registerDynamicMcpClient(
  metadata: Record<string, unknown>,
): Promise<Result<DynamicClientRegistrationResponse>> {
  const redirectUris = validateDynamicRedirectUris(metadata.redirect_uris);
  if (!redirectUris.ok) return redirectUris;

  const authMethod =
    typeof metadata.token_endpoint_auth_method === "string"
      ? metadata.token_endpoint_auth_method
      : "none";
  if (authMethod !== "none") {
    return err(
      registrationError("Pilot dynamic MCP registration supports public PKCE clients only."),
    );
  }

  const requestedScope = typeof metadata.scope === "string" ? metadata.scope : "";
  const rawScopes = requestedScope
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  const scopesResult =
    rawScopes.length > 0
      ? assertKnownScopes(rawScopes)
      : ok([...ALL_MCP_SCOPES]);
  if (!scopesResult.ok) return scopesResult;

  const now = Math.floor(Date.now() / 1000);
  const clientId = createOpaqueToken("plo_mcp_client");
  const clientName = normaliseClientName(metadata.client_name);
  const clientUri =
    typeof metadata.client_uri === "string" && metadata.client_uri.startsWith("https://")
      ? metadata.client_uri
      : undefined;

  const secret = createSupabaseSecretClient();
  const { error } = await secret.from("mcp_oauth_clients").insert({
    client_id: clientId,
    name: clientName,
    description: "Dynamically registered MCP OAuth client.",
    client_type: "public",
    redirect_uris: redirectUris.value,
    allowed_scopes: scopesResult.value,
    status: "active",
  });
  if (error) return err(new AppError("internal", error.message));

  return ok({
    client_id: clientId,
    client_id_issued_at: now,
    client_secret_expires_at: 0,
    redirect_uris: redirectUris.value,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: clientName,
    ...(clientUri ? { client_uri: clientUri } : {}),
    scope: scopesResult.value.join(" "),
  });
}

async function validateClientSecret(input: {
  readonly client: McpClient;
  readonly clientSecret: string | null;
}): Promise<boolean> {
  if (input.client.clientType === "public") return true;
  if (!input.clientSecret) return false;

  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("mcp_oauth_clients")
    .select("client_secret_hash")
    .eq("id", input.client.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const expected = String(data?.client_secret_hash ?? "");
  const actual = hashToken(input.clientSecret);
  if (!expected || expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export interface AuthorizationRequestView {
  readonly client: McpClient;
  readonly requestedScopes: readonly McpScope[];
  readonly scopeDescriptions: readonly { scope: McpScope; description: string }[];
  readonly redirectUri: string;
  readonly state: string | null;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: string;
}

export async function validateAuthorizationRequest(
  searchParams: URLSearchParams,
): Promise<Result<AuthorizationRequestView>> {
  const responseType = searchParams.get("response_type");
  const clientId = searchParams.get("client_id") ?? "";
  const redirectUri = searchParams.get("redirect_uri") ?? "";
  const codeChallenge = searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = searchParams.get("code_challenge_method") ?? "plain";

  if (responseType !== "code") {
    return err(new ValidationError("MCP authorisation only supports response_type=code."));
  }
  if (!clientId || !redirectUri) {
    return err(new ValidationError("Missing MCP client or redirect URI."));
  }
  if (!codeChallenge) {
    return err(new ValidationError("MCP authorisation requires PKCE."));
  }
  if (!["plain", "S256"].includes(codeChallengeMethod)) {
    return err(new ValidationError("Unsupported PKCE challenge method."));
  }

  const client = await getClientByClientId(clientId);
  if (!client || client.status !== "active") {
    return err(new PolicyDeniedError("This MCP client is not approved for Pilot."));
  }
  if (!validateRedirectUri(client, redirectUri)) {
    return err(new PolicyDeniedError("This redirect URI is not registered for the MCP client."));
  }

  const rawScopes = (searchParams.get("scope") ?? "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  const scopeResult =
    rawScopes.length > 0 ? assertKnownScopes(rawScopes) : ok(["memory:read"] as McpScope[]);
  if (!scopeResult.ok) return scopeResult;
  const scopes = scopeResult.value;
  if (!hasScopes(client.allowedScopes, scopes)) {
    return err(
      new PolicyDeniedError("The MCP client requested access it is not allowed to ask for.", {
        requestedScopes: scopes,
      }),
    );
  }

  return ok({
    client,
    requestedScopes: scopes,
    scopeDescriptions: scopes.map((scope) => ({
      scope,
      description: MCP_SCOPES[scope],
    })),
    redirectUri,
    state: searchParams.get("state"),
    codeChallenge,
    codeChallengeMethod,
  });
}

export async function createAuthorizationCode(input: {
  readonly ctx: TenantContext;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly McpScope[];
  readonly codeChallenge: string;
  readonly codeChallengeMethod: string;
}): Promise<Result<string>> {
  const client = await getClientByClientId(input.clientId);
  if (!client || client.status !== "active") {
    return err(new PolicyDeniedError("This MCP client is not approved for Pilot."));
  }
  if (!validateRedirectUri(client, input.redirectUri)) {
    return err(new PolicyDeniedError("This redirect URI is not registered for the MCP client."));
  }
  if (!hasScopes(client.allowedScopes, input.scopes)) {
    return err(new PolicyDeniedError("The MCP client requested scopes it cannot use."));
  }

  const secret = createSupabaseSecretClient();
  const now = new Date();
  const { data: grant, error: grantError } = await secret
    .from("mcp_oauth_grants")
    .upsert(
      {
        tenant_id: input.ctx.tenantId,
        user_id: input.ctx.userId,
        client_id: client.id,
        scopes: input.scopes,
        status: "active",
        revoked_at: null,
      },
      { onConflict: "tenant_id,user_id,client_id" },
    )
    .select("id")
    .single();
  if (grantError || !grant) {
    return err(new AppError("internal", grantError?.message ?? "Could not create MCP grant."));
  }

  const code = createOpaqueToken("plo_mcp_code");
  const { error: codeError } = await secret.from("mcp_oauth_authorization_codes").insert({
    code_hash: hashToken(code),
    grant_id: grant.id,
    client_id: client.id,
    tenant_id: input.ctx.tenantId,
    user_id: input.ctx.userId,
    redirect_uri: input.redirectUri,
    scopes: input.scopes,
    code_challenge: input.codeChallenge,
    code_challenge_method: input.codeChallengeMethod,
    expires_at: addSeconds(now, AUTHORISATION_CODE_TTL_MINUTES * 60).toISOString(),
  });
  if (codeError) {
    return err(new AppError("internal", codeError.message));
  }

  await recordMcpAudit(
    {
      ...input.ctx,
      grantId: grant.id,
      clientId: client.clientId,
      clientName: client.name,
      scopes: [...input.scopes],
      accessTokenId: "authorization",
    },
    {
      eventType: "mcp.oauth.authorized",
      status: "success",
      metadata: { scopes: input.scopes },
    },
  );
  return ok(code);
}

export interface TokenResponse {
  readonly access_token: string;
  readonly token_type: "Bearer";
  readonly expires_in: number;
  readonly refresh_token?: string;
  readonly scope: string;
}

export async function exchangeAuthorizationCode(input: {
  readonly code: string;
  readonly clientId: string;
  readonly clientSecret: string | null;
  readonly redirectUri: string;
  readonly codeVerifier: string;
}): Promise<Result<TokenResponse>> {
  const client = await getClientByClientId(input.clientId);
  if (!client || client.status !== "active") {
    return err(new PolicyDeniedError("Unknown or inactive MCP client."));
  }
  if (!(await validateClientSecret({ client, clientSecret: input.clientSecret }))) {
    return err(new PolicyDeniedError("MCP client authentication failed."));
  }

  const secret = createSupabaseSecretClient();
  const codeHash = hashToken(input.code);
  const { data: codeRow, error: codeError } = await secret
    .from("mcp_oauth_authorization_codes")
    .select("*")
    .eq("code_hash", codeHash)
    .eq("client_id", client.id)
    .maybeSingle();
  if (codeError) throw new Error(codeError.message);
  if (!codeRow || codeRow.consumed_at || new Date(codeRow.expires_at) <= new Date()) {
    return err(new PolicyDeniedError("The MCP authorisation code is invalid or expired."));
  }
  if (codeRow.redirect_uri !== input.redirectUri) {
    return err(new PolicyDeniedError("The redirect URI does not match the authorisation request."));
  }
  if (
    !verifyPkce({
      codeVerifier: input.codeVerifier,
      codeChallenge: codeRow.code_challenge,
      method: codeRow.code_challenge_method,
    })
  ) {
    return err(new PolicyDeniedError("PKCE verification failed."));
  }

  const now = new Date();
  const accessToken = createOpaqueToken("plo_mcp_at");
  const refreshToken = createOpaqueToken("plo_mcp_rt");
  const accessExpiresAt = addSeconds(now, ACCESS_TOKEN_TTL_SECONDS).toISOString();
  const refreshExpiresAt = addDays(now, REFRESH_TOKEN_TTL_DAYS).toISOString();
  const scopes = (codeRow.scopes ?? []) as McpScope[];

  const { data: accessRow, error: accessError } = await secret
    .from("mcp_oauth_access_tokens")
    .insert({
      grant_id: codeRow.grant_id,
      token_hash: hashToken(accessToken),
      scopes,
      expires_at: accessExpiresAt,
    })
    .select("id")
    .single();
  if (accessError || !accessRow) {
    return err(new AppError("internal", accessError?.message ?? "Could not create MCP token."));
  }

  await secret
    .from("mcp_oauth_grants")
    .update({
      refresh_token_hash: hashToken(refreshToken),
      refresh_token_expires_at: refreshExpiresAt,
      refresh_token_rotated_at: now.toISOString(),
      last_used_at: now.toISOString(),
    })
    .eq("id", codeRow.grant_id);
  await secret
    .from("mcp_oauth_authorization_codes")
    .update({ consumed_at: now.toISOString() })
    .eq("id", codeRow.id);

  return ok({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: scopes.join(" "),
  });
}

export async function rotateRefreshToken(input: {
  readonly refreshToken: string;
  readonly clientId: string;
  readonly clientSecret: string | null;
}): Promise<Result<TokenResponse>> {
  const client = await getClientByClientId(input.clientId);
  if (!client || client.status !== "active") {
    return err(new PolicyDeniedError("Unknown or inactive MCP client."));
  }
  if (!(await validateClientSecret({ client, clientSecret: input.clientSecret }))) {
    return err(new PolicyDeniedError("MCP client authentication failed."));
  }

  const secret = createSupabaseSecretClient();
  const { data: grant, error } = await secret
    .from("mcp_oauth_grants")
    .select("*")
    .eq("refresh_token_hash", hashToken(input.refreshToken))
    .eq("client_id", client.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (
    !grant ||
    grant.status !== "active" ||
    !grant.refresh_token_expires_at ||
    new Date(grant.refresh_token_expires_at) <= new Date()
  ) {
    return err(new PolicyDeniedError("The MCP refresh token is invalid or expired."));
  }

  const now = new Date();
  const accessToken = createOpaqueToken("plo_mcp_at");
  const refreshToken = createOpaqueToken("plo_mcp_rt");
  const scopes = (grant.scopes ?? []) as McpScope[];
  await secret.from("mcp_oauth_access_tokens").insert({
    grant_id: grant.id,
    token_hash: hashToken(accessToken),
    scopes,
    expires_at: addSeconds(now, ACCESS_TOKEN_TTL_SECONDS).toISOString(),
  });
  await secret
    .from("mcp_oauth_grants")
    .update({
      refresh_token_hash: hashToken(refreshToken),
      refresh_token_expires_at: addDays(now, REFRESH_TOKEN_TTL_DAYS).toISOString(),
      refresh_token_rotated_at: now.toISOString(),
      last_used_at: now.toISOString(),
    })
    .eq("id", grant.id);

  return ok({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: scopes.join(" "),
  });
}

export async function validateBearerToken(
  authorization: string | null,
  requiredScopes: readonly McpScope[] = [],
): Promise<Result<McpAuthContext>> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return err(new AppError("unauthenticated", "Missing MCP bearer token."));

  const secret = createSupabaseSecretClient();
  const { data: tokenRow, error: tokenError } = await secret
    .from("mcp_oauth_access_tokens")
    .select("*")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (tokenError) throw new Error(tokenError.message);
  if (
    !tokenRow ||
    tokenRow.revoked_at ||
    new Date(tokenRow.expires_at) <= new Date()
  ) {
    return err(new AppError("unauthenticated", "The MCP bearer token is invalid or expired."));
  }

  const { data: grant, error: grantError } = await secret
    .from("mcp_oauth_grants")
    .select("*")
    .eq("id", tokenRow.grant_id)
    .maybeSingle();
  if (grantError) throw new Error(grantError.message);
  if (!grant || grant.status !== "active") {
    return err(new PolicyDeniedError("The MCP grant has been revoked."));
  }

  const { data: clientRow, error: clientError } = await secret
    .from("mcp_oauth_clients")
    .select(
      "id, client_id, name, description, client_type, redirect_uris, allowed_scopes, status, created_at",
    )
    .eq("id", grant.client_id)
    .maybeSingle();
  if (clientError) throw new Error(clientError.message);
  if (!clientRow || clientRow.status !== "active") {
    return err(new PolicyDeniedError("The MCP client is no longer active."));
  }

  const scopes = (tokenRow.scopes ?? []) as McpScope[];
  if (!hasScopes(scopes, requiredScopes)) {
    return err(new PolicyDeniedError("The MCP token does not include the required scope."));
  }

  const now = new Date().toISOString();
  await Promise.all([
    secret
      .from("mcp_oauth_access_tokens")
      .update({ last_used_at: now })
      .eq("id", tokenRow.id),
    secret.from("mcp_oauth_grants").update({ last_used_at: now }).eq("id", grant.id),
  ]);

  return ok({
    tenantId: grant.tenant_id,
    tenantSlug: "",
    userId: grant.user_id,
    role: "member",
    grantId: grant.id,
    clientId: clientRow.client_id,
    clientName: clientRow.name,
    scopes,
    accessTokenId: tokenRow.id,
  });
}

export async function revokeTokenOrGrant(input: {
  readonly token: string;
  readonly tokenTypeHint?: string | null;
  readonly clientId: string;
  readonly clientSecret: string | null;
}): Promise<Result<void>> {
  const client = await getClientByClientId(input.clientId);
  if (!client || !(await validateClientSecret({ client, clientSecret: input.clientSecret }))) {
    return err(new PolicyDeniedError("MCP client authentication failed."));
  }
  const secret = createSupabaseSecretClient();
  const tokenHash = hashToken(input.token);
  const now = new Date().toISOString();
  if (input.tokenTypeHint === "refresh_token") {
    await secret
      .from("mcp_oauth_grants")
      .update({ status: "revoked", revoked_at: now, refresh_token_hash: null })
      .eq("refresh_token_hash", tokenHash)
      .eq("client_id", client.id);
  } else {
    await secret
      .from("mcp_oauth_access_tokens")
      .update({ revoked_at: now })
      .eq("token_hash", tokenHash);
  }
  return ok(undefined);
}

export async function introspectToken(input: {
  readonly token: string;
  readonly clientId: string;
  readonly clientSecret: string | null;
}): Promise<Result<Record<string, unknown>>> {
  const client = await getClientByClientId(input.clientId);
  if (!client || !(await validateClientSecret({ client, clientSecret: input.clientSecret }))) {
    return err(new PolicyDeniedError("MCP client authentication failed."));
  }
  const validation = await validateBearerToken(`Bearer ${input.token}`);
  if (!validation.ok) return ok({ active: false });
  return ok({
    active: true,
    client_id: validation.value.clientId,
    tenant_id: validation.value.tenantId,
    user_id: validation.value.userId,
    scope: validation.value.scopes.join(" "),
  });
}

export async function listMcpGrants(ctx: TenantContext): Promise<McpGrant[]> {
  const secret = createSupabaseSecretClient();
  const { data: grants, error } = await secret
    .from("mcp_oauth_grants")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.userId)
    .order("granted_at", { ascending: false });
  if (error) throw new Error(error.message);
  if (!grants?.length) return [];

  const clientIds = [...new Set(grants.map((grant: any) => grant.client_id))];
  const { data: clients, error: clientError } = await secret
    .from("mcp_oauth_clients")
    .select(
      "id, client_id, name, description, client_type, redirect_uris, allowed_scopes, status, created_at",
    )
    .in("id", clientIds);
  if (clientError) throw new Error(clientError.message);
  const clientsById = new Map((clients ?? []).map((client: any) => [client.id, mapClient(client)]));

  return grants.map((grant: any) => ({
    id: grant.id,
    tenantId: grant.tenant_id,
    userId: grant.user_id,
    client: clientsById.get(grant.client_id)!,
    scopes: grant.scopes ?? [],
    status: grant.status,
    grantedAt: grant.granted_at,
    revokedAt: grant.revoked_at,
    lastUsedAt: grant.last_used_at,
    refreshTokenExpiresAt: grant.refresh_token_expires_at,
  }));
}

export async function revokeGrant(ctx: TenantContext, grantId: string): Promise<Result<void>> {
  const secret = createSupabaseSecretClient();
  const now = new Date().toISOString();
  const { error } = await secret
    .from("mcp_oauth_grants")
    .update({ status: "revoked", revoked_at: now, refresh_token_hash: null })
    .eq("id", grantId)
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.userId);
  if (error) return err(new AppError("internal", error.message));
  await secret
    .from("mcp_oauth_access_tokens")
    .update({ revoked_at: now })
    .eq("grant_id", grantId);
  await recordMcpAudit(
    {
      ...ctx,
      grantId,
      clientId: "user-managed",
      clientName: "User-managed revocation",
      scopes: [],
      accessTokenId: "revocation",
    },
    { eventType: "mcp.oauth.revoked", status: "success" },
  );
  return ok(undefined);
}

export async function recordMcpAudit(
  auth: McpAuthContext,
  event: {
    readonly eventType: string;
    readonly status: "success" | "denied" | "error";
    readonly toolName?: string;
    readonly metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const secret = createSupabaseSecretClient();
  await secret.from("mcp_audit_events").insert({
    tenant_id: auth.tenantId,
    user_id: auth.userId,
    grant_id: auth.grantId,
    client_id: auth.clientId,
    event_type: event.eventType,
    tool_name: event.toolName ?? null,
    scopes: auth.scopes,
    status: event.status,
    metadata: event.metadata ?? {},
  });
}
