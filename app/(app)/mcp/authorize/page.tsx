import { validateAuthorizationRequest } from "@/modules/mcp";
import { approveMcpClientAction } from "./actions";

export const metadata = {
  title: "Authorise MCP access · Pilot",
  robots: { index: false, follow: false },
};

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

  const request = await validateAuthorizationRequest(params);
  if (!request.ok) {
    return (
      <main className="workspace__content">
        <div className="page-head">
          <p className="eyebrow">MCP Access</p>
          <h1 className="page-head__title">This request cannot be approved</h1>
          <p className="page-head__lead">{request.error.message}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">MCP Access</p>
        <h1 className="page-head__title">
          Allow {request.value.client.name} to read your Pilot memory?
        </h1>
        <p className="page-head__lead">
          This gives the client a controlled connection to this workspace only.
          You can revoke it from Tool Layer at any time.
        </p>
      </div>

      <section className="card" style={{ maxWidth: "760px" }}>
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
        <form action={approveMcpClientAction} className="form-row" style={{ marginTop: "var(--space-lg)" }}>
          <input type="hidden" name="clientId" value={request.value.client.clientId} />
          <input type="hidden" name="redirectUri" value={request.value.redirectUri} />
          <input type="hidden" name="state" value={request.value.state ?? ""} />
          <input type="hidden" name="scope" value={request.value.requestedScopes.join(" ")} />
          <input type="hidden" name="codeChallenge" value={request.value.codeChallenge} />
          <input type="hidden" name="codeChallengeMethod" value={request.value.codeChallengeMethod} />
          <button type="submit" className="btn btn--primary">
            Allow Access
          </button>
          <a className="btn btn--ghost" href="/mcp">
            Cancel
          </a>
        </form>
      </section>
    </main>
  );
}
