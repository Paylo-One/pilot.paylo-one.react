/**
 * components/sources/connect-action.tsx
 *
 * The real (or honestly-disabled) connect control for a source, shown on the
 * source detail view. OAuth sources link to their start routes; enterprise and
 * phased sources state why they cannot connect yet. File-upload sources have
 * their form on the detail page itself, so they render no separate control.
 */

import { DisconnectButton } from "@/app/(app)/sources/disconnect-button";
import type { SourceView } from "@/modules/source-connection/source.types";

export function ConnectAction({ view }: { view: SourceView }) {
  const connected = view.connectionId !== null;

  switch (view.connect) {
    case "github_oauth":
      if (connected && view.connectionId) {
        return <DisconnectButton connectionId={view.connectionId} />;
      }
      return view.githubConfigured ? (
        <a className="btn btn--primary btn--sm" href="/api/oauth/github/start">
          Connect GitHub
        </a>
      ) : (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled
          title="Add GITHUB_OAUTH_CLIENT_ID / SECRET to enable"
        >
          Needs credentials
        </button>
      );
    case "google_oauth":
      if (connected && view.connectionId) {
        return <DisconnectButton connectionId={view.connectionId} />;
      }
      return view.googleConfigured ? (
        <a className="btn btn--primary btn--sm" href="/api/oauth/google/start">
          Connect Google
        </a>
      ) : (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled
          title="Add GOOGLE_OAUTH_CLIENT_ID / SECRET to enable"
        >
          Needs credentials
        </button>
      );
    case "microsoft_oauth": {
      if (connected && view.connectionId) {
        return <DisconnectButton connectionId={view.connectionId} />;
      }
      const product = view.system === "teams" ? "teams" : "mail";
      return view.microsoftConfigured ? (
        <a
          className="btn btn--primary btn--sm"
          href={`/api/oauth/microsoft/start?product=${product}`}
        >
          {view.system === "teams" ? "Connect Teams" : "Connect Microsoft 365"}
        </a>
      ) : (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled
          title="Add MICROSOFT_OAUTH_CLIENT_ID / SECRET to enable"
        >
          Needs credentials
        </button>
      );
    }
    case "enterprise":
      return (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled
          title="Requires enterprise / admin consent"
        >
          Admin consent
        </button>
      );
    case "phased":
      return (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled
          title="Coming soon — not yet available to connect"
        >
          Coming soon
        </button>
      );
    case "file_upload":
    case "news_preferences":
    case "scaffold":
    default:
      return null;
  }
}
