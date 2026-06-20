import { redirect } from "next/navigation";
import { appHostBaseUrl } from "@/lib/config";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { getSignedInUser } from "@/modules/identity-tenant/server";
import { validateAuthorizationRequest } from "@/modules/mcp";
import { approveMcpClientAction } from "./actions";

export const metadata = {
  title: "Authorise MCP access · Pilot",
  robots: { index: false, follow: false },
};

interface WorkspaceOption {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly role: string;
}

async function listUserWorkspaces(userId: string): Promise<WorkspaceOption[]> {
  const secret = createSupabaseSecretClient();
  const { data: memberships, error } = await secret
    .from("tenant_users")
    .select("tenant_id, role")
    .eq("user_id", userId);
  if (error || !memberships?.length) return [];

  const tenantIds = memberships.map((membership: any) => membership.tenant_id);
  const { data: tenants, error: tenantError } = await secret
    .from("tenants")
    .select("id, slug, name, status")
    .in("id", tenantIds)
    .eq("status", "active");
  if (tenantError || !tenants?.length) return [];

  const roleByTenant = new Map(
    memberships.map((membership: any) => [
      membership.tenant_id,
      membership.role,
    ]),
  );

  return tenants.map((tenant: any) => ({
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    role: roleByTenant.get(tenant.id) ?? "member",
  }));
}

export default async function McpAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }

  const user = await getSignedInUser();
  if (!user) {
    redirect(
      `${appHostBaseUrl()}/sign-in?next=${encodeURIComponent(
        `/mcp/authorize?${params.toString()}`,
      )}`,
    );
  }

  const request = await validateAuthorizationRequest(params);
  if (!request.ok) {
    return (
      <>
        <p className="eyebrow">MCP Access</p>
        <h1 style={{ fontSize: "var(--text-h1)", margin: "var(--space-xs) 0 var(--space-sm)" }}>
          This request cannot be approved
        </h1>
        <p className="text-secondary">{request.error.message}</p>
      </>
    );
  }

  const workspaces = await listUserWorkspaces(user.userId);
  if (workspaces.length === 0) {
    return (
      <>
        <p className="eyebrow">MCP Access</p>
        <h1 style={{ fontSize: "var(--text-h1)", margin: "var(--space-xs) 0 var(--space-sm)" }}>
          No workspace is available
        </h1>
        <p className="text-secondary">
          Sign in with an account that belongs to a Pilot workspace before
          approving MCP access.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="eyebrow">MCP Access</p>
      <h1 style={{ fontSize: "var(--text-h1)", margin: "var(--space-xs) 0 var(--space-sm)" }}>
        Allow {request.value.client.name} to use Pilot memory?
      </h1>
      <p className="text-secondary" style={{ marginBottom: "var(--space-lg)" }}>
        This creates a scoped connection to one workspace. You can revoke it
        from MCP Access at any time.
      </p>

      <section className="card" style={{ boxShadow: "none" }}>
        <div className="card-head">
          <div>
            <p className="eyebrow">Requested access</p>
            <h2 className="card__title">{request.value.client.name}</h2>
          </div>
          <span className="status status--info">Needs approval</span>
        </div>
        <p className="action-card__rationale">
          {request.value.client.description ??
            "This client wants to use Pilot context through MCP."}
        </p>
        <div className="stack" style={{ gap: "var(--space-sm)", marginTop: "var(--space-md)" }}>
          {request.value.scopeDescriptions.map((scope) => (
            <div className="meta-row" key={scope.scope}>
              <span className="meta-row__key mono">{scope.scope}</span>
              <span className="meta-row__value">{scope.description}</span>
            </div>
          ))}
        </div>

        <form action={approveMcpClientAction} className="stack" style={{ gap: "var(--space-md)", marginTop: "var(--space-lg)" }}>
          <label className="field">
            <span className="field__label">Workspace</span>
            <select className="input" name="tenantId" defaultValue={workspaces[0]?.id}>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name} ({workspace.slug}.paylo.one) · {workspace.role}
                </option>
              ))}
            </select>
          </label>
          <input type="hidden" name="clientId" value={request.value.client.clientId} />
          <input type="hidden" name="redirectUri" value={request.value.redirectUri} />
          <input type="hidden" name="state" value={request.value.state ?? ""} />
          <input type="hidden" name="scope" value={request.value.requestedScopes.join(" ")} />
          <input type="hidden" name="codeChallenge" value={request.value.codeChallenge} />
          <input type="hidden" name="codeChallengeMethod" value={request.value.codeChallengeMethod} />
          <div className="form-row">
            <button type="submit" className="btn btn--primary">
              Allow Access
            </button>
            <a className="btn btn--ghost" href="/sign-in">
              Cancel
            </a>
          </div>
        </form>
      </section>
    </>
  );
}
