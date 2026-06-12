/**
 * app/(app)/sources/source-views.ts
 *
 * Server-side builder for the operator-facing SourceView list: merges the
 * designed catalogue (SOURCE_DESCRIPTORS) with live connection state, then
 * loads the per-system extras (GitHub monitors, Notion resources, Google scope
 * items, WhatsApp session) only for systems that are actually connected.
 *
 * Shared by the Sources catalogue page and the per-source detail pages so both
 * derive status identically. Governance: services/source-connection.md.
 */

import { whatsappBridgeEnabled } from "@/lib/config";
import { listSourceConnections } from "@/modules/source-connection/server";
import { isGithubOAuthConfigured } from "@/modules/source-connection/github";
import { listRepositoryMonitors } from "@/modules/source-connection/github-repos";
import { listNotionResources } from "@/modules/source-connection/notion";
import { isGoogleOAuthConfigured } from "@/modules/source-connection/google";
import { isMicrosoftOAuthConfigured } from "@/modules/source-connection/microsoft";
import { listScopeItems } from "@/modules/source-connection/source-scope";
import {
  getWhatsAppSession,
  listWhatsAppMonitors,
} from "@/modules/source-connection/whatsapp-server";
import { SOURCE_SYSTEM_LABELS } from "@/modules/source-connection";
import {
  SOURCE_DESCRIPTORS,
  deriveSourceStatus,
  isInDailyMemo,
} from "@/modules/source-connection/source-service";
import type { SourceView } from "@/modules/source-connection/source.types";

export function formatTimestamp(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function buildSourceViews(): Promise<SourceView[]> {
  const connections = await listSourceConnections();
  const connectionBySystem = new Map(connections.map((c) => [c.system, c]));

  const githubConfigured = isGithubOAuthConfigured();
  const googleConfigured = isGoogleOAuthConfigured();
  const microsoftConfigured = isMicrosoftOAuthConfigured();

  // Real, persisted repository monitors for a *connected* GitHub (if any).
  const githubConnection = connectionBySystem.get("github");
  const githubRepositories =
    githubConnection && githubConnection.status === "connected"
      ? await listRepositoryMonitors(githubConnection.id)
      : [];

  // Real, persisted Notion resources for a *connected* Notion (if any).
  const notionConnection = connectionBySystem.get("notion");
  const notionResources =
    notionConnection && notionConnection.status === "connected"
      ? await listNotionResources(notionConnection.id)
      : [];

  // Scope-item families: Google (email = Gmail labels, calendar) and
  // Microsoft 365 (ms365_mail = folders + calendars, teams = chats + channels).
  const scopeItemsFor = (system: "email" | "calendar" | "ms365_mail" | "teams") => {
    const connection = connectionBySystem.get(system);
    return connection && connection.status === "connected"
      ? listScopeItems(connection.id)
      : Promise.resolve([]);
  };
  const [emailScopeItems, calendarScopeItems, ms365ScopeItems, teamsScopeItems] =
    await Promise.all([
      scopeItemsFor("email"),
      scopeItemsFor("calendar"),
      scopeItemsFor("ms365_mail"),
      scopeItemsFor("teams"),
    ]);

  // WhatsApp: tenant session + approved monitors. The bridge flag decides
  // whether the card drives the real Web-session bridge or the scaffold path.
  const bridgeEnabled = whatsappBridgeEnabled();
  const whatsappSession = await getWhatsAppSession();
  const whatsappMonitors = whatsappSession
    ? await listWhatsAppMonitors(whatsappSession.id)
    : [];

  // Merge each designed source with its live connection into a serialisable
  // view for the client components. Scope/policy stay conservative by default.
  return SOURCE_DESCRIPTORS.map((d) => {
    const connection = connectionBySystem.get(d.system);
    const status = deriveSourceStatus(d, connection);
    const lastSync = connection ? formatTimestamp(connection.updatedAt) : "";
    return {
      system: d.system,
      name: SOURCE_SYSTEM_LABELS[d.system],
      provider: d.provider,
      description: d.description,
      category: d.category,
      status,
      mvpStatus: d.mvpStatus,
      storagePolicy: connection?.storagePolicy ?? d.defaultPolicy,
      authModel: d.authModel,
      dataPulled: d.dataPulled,
      scopeControl: d.scopeControl,
      dailyMemoUse: d.dailyMemoUse,
      riskNote: d.riskNote,
      lastSync: status === "active" && lastSync ? lastSync : null,
      referenceReady: d.referenceReady,
      inDailyMemo: isInDailyMemo(d, status),
      connect: d.connect,
      // Only a *connected* connection counts as connected in the UI. A stale
      // `disconnected`/`error` row must still surface the Connect affordance
      // (and the selector's connect prompt), not a phantom connected state.
      connectionId: connection?.status === "connected" ? connection.id : null,
      githubConfigured,
      githubRepositories: d.system === "github" ? githubRepositories : [],
      notionResources: d.system === "notion" ? notionResources : [],
      googleConfigured,
      microsoftConfigured,
      scopeItems:
        d.system === "email"
          ? emailScopeItems
          : d.system === "calendar"
            ? calendarScopeItems
            : d.system === "ms365_mail"
              ? ms365ScopeItems
              : d.system === "teams"
                ? teamsScopeItems
                : [],
      whatsappSession: d.system === "whatsapp" ? whatsappSession : null,
      whatsappMonitors: d.system === "whatsapp" ? whatsappMonitors : [],
      whatsappBridgeEnabled: d.system === "whatsapp" ? bridgeEnabled : false,
    };
  });
}
