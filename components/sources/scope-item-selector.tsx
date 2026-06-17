"use client";

/**
 * components/sources/scope-item-selector.tsx
 *
 * Generic scope selector for the OAuth scope-item families — Google (Gmail
 * labels, Google calendars) and Microsoft 365 (mail folders + calendars, Teams
 * chats + channels). The operator activates which items to sync and runs a
 * sync. Only active items are ingested — scope is explicit (ADR-026).
 *
 * Governance: architecture/source-integration-strategy.md §8/§9/§10, ADR-037.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SourceScopeItem, SourceType } from "@/modules/source-connection/source.types";
import {
  updateScopeItemAction,
  syncGoogleAction,
  syncMicrosoftAction,
  syncSlackAction,
  syncDiscordAction,
} from "@/app/(app)/sources/actions";
import { Toggle } from "./toggle";
import { SourceIcon } from "./source-icon";

function formatSync(value: string | null): string {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "never";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface FamilyCopy {
  plural: string;
  singular: string;
  heading: string;
  scopeNote: string;
  connectHref: string;
  connectLabel: string;
  connectPrompt: string;
  unconfigured: string;
}

const FAMILY: Partial<Record<SourceType, FamilyCopy>> = {
  email: {
    plural: "labels",
    singular: "label",
    heading: "Gmail labels",
    scopeNote: "Read-only. Only the labels you activate are synced (last 7 days).",
    connectHref: "/api/oauth/google/start",
    connectLabel: "Connect Google",
    connectPrompt:
      "Connect Google (read-only). One authorisation covers both Gmail and Calendar; you then choose which labels/calendars to sync.",
    unconfigured:
      "Google OAuth is not configured. Add GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET to enable.",
  },
  calendar: {
    plural: "calendars",
    singular: "calendar",
    heading: "Google calendars",
    scopeNote: "Read-only. Only the calendars you activate are synced (today + 7 days).",
    connectHref: "/api/oauth/google/start",
    connectLabel: "Connect Google",
    connectPrompt:
      "Connect Google (read-only). One authorisation covers both Gmail and Calendar; you then choose which labels/calendars to sync.",
    unconfigured:
      "Google OAuth is not configured. Add GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET to enable.",
  },
  ms365_mail: {
    plural: "folders & calendars",
    singular: "item",
    heading: "Mail folders & calendars",
    scopeNote:
      "Read-only (Mail.Read + Calendars.Read). Only the folders and calendars you activate are synced (mail: last 7 days; events: next 7 days).",
    connectHref: "/api/oauth/microsoft/start?product=mail",
    connectLabel: "Connect Microsoft 365",
    connectPrompt:
      "Connect Microsoft 365 (read-only Entra consent). One authorisation covers Exchange mail and calendars; you then choose which folders/calendars to sync.",
    unconfigured:
      "Microsoft OAuth is not configured. Add MICROSOFT_OAUTH_CLIENT_ID / MICROSOFT_OAUTH_CLIENT_SECRET to enable.",
  },
  teams: {
    plural: "chats & channels",
    singular: "chat",
    heading: "Chats & channels",
    scopeNote:
      "Read-only (Chat.Read). Only the chats/channels you activate are synced. Channel messages additionally need tenant-admin consent — denied channels are skipped, never silently ingested.",
    connectHref: "/api/oauth/microsoft/start?product=teams",
    connectLabel: "Connect Teams",
    connectPrompt:
      "Connect Microsoft Teams (read-only Entra consent). Chats are user-consentable; channel messages need your Microsoft 365 admin's consent.",
    unconfigured:
      "Microsoft OAuth is not configured. Add MICROSOFT_OAUTH_CLIENT_ID / MICROSOFT_OAUTH_CLIENT_SECRET to enable.",
  },
  slack: {
    plural: "channels",
    singular: "channel",
    heading: "Slack channels",
    scopeNote:
      "Read-only public channels first. Active channels are synced incrementally; mute noisy channels from the Daily Memo without removing them from search.",
    connectHref: "/api/oauth/slack/start",
    connectLabel: "Connect Slack",
    connectPrompt:
      "Connect Slack (read-only). You then choose exactly which public channels to monitor.",
    unconfigured:
      "Slack OAuth is not configured. Add SLACK_CLIENT_ID / SLACK_CLIENT_SECRET to enable.",
  },
  discord: {
    plural: "channels",
    singular: "channel",
    heading: "Discord server channels",
    scopeNote:
      "Bot-based read access. Only active server channels are synced; the bot needs View Channel, Read Message History, and Message Content intent for text.",
    connectHref: "/api/oauth/discord/start",
    connectLabel: "Connect Discord",
    connectPrompt:
      "Connect Discord and install the bot. You then choose which server channels to monitor.",
    unconfigured:
      "Discord OAuth is not configured. Add DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / DISCORD_BOT_TOKEN to enable.",
  },
};

export function ScopeItemSelector({
  items,
  connectionId,
  system,
  configured,
}: {
  items: readonly SourceScopeItem[];
  connectionId: string | null;
  system: SourceType;
  configured: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const copy = FAMILY[system] ?? FAMILY.email!;

  const display = useMemo(
    () => items.map((i) => (i.id in overrides ? { ...i, isActive: overrides[i.id]! } : i)),
    [items, overrides],
  );
  const activeCount = display.filter((i) => i.isActive).length;

  // --- Not connected -------------------------------------------------------
  if (!connectionId) {
    return (
      <div className="repo-selector">
        <p className="scaffold-note" style={{ marginBottom: "var(--space-md)" }}>
          {configured ? copy.connectPrompt : copy.unconfigured}
        </p>
        {configured ? (
          <a className="btn btn--secondary btn--sm" href={copy.connectHref}>
            {copy.connectLabel}
          </a>
        ) : (
          <button type="button" className="btn btn--ghost btn--sm" disabled>
            Needs credentials
          </button>
        )}
      </div>
    );
  }

  // --- Connected -----------------------------------------------------------
  function toggle(item: SourceScopeItem) {
    const next = !item.isActive;
    setOverrides((p) => ({ ...p, [item.id]: next }));
    setMessage(null);
    startTransition(async () => {
      const res = await updateScopeItemAction({ scopeItemId: item.id, isActive: next });
      if (!res.ok && res.error) {
        setOverrides((p) => ({ ...p, [item.id]: !next }));
        setMessage(res.error);
      }
    });
  }

  function runSync() {
    setMessage(null);
    startTransition(async () => {
      const res =
        system === "slack"
          ? await syncSlackAction()
          : system === "discord"
            ? await syncDiscordAction()
            : system === "ms365_mail" || system === "teams"
          ? await syncMicrosoftAction({ system })
          : await syncGoogleAction({ system });
      if (res.ok) {
        const denied =
          "deniedCount" in res && res.deniedCount
            ? ` ${res.deniedCount} channel(s) skipped — needs tenant-admin consent.`
            : "";
        setMessage(
          `Synced ${res.itemCount ?? 0} item(s) from ${res.scopeCount ?? 0} ${copy.plural}.${denied}`,
        );
        router.refresh();
      } else {
        setMessage(res.error ?? "Sync failed.");
      }
    });
  }

  function setMemoInclusion(item: SourceScopeItem, includeInDailyMemo: boolean) {
    setMessage(null);
    startTransition(async () => {
      const res = await updateScopeItemAction({
        scopeItemId: item.id,
        includeInDailyMemo,
      });
      if (!res.ok && res.error) setMessage(res.error);
      router.refresh();
    });
  }

  function setPriority(item: SourceScopeItem, priority: "normal" | "high") {
    setMessage(null);
    startTransition(async () => {
      const res = await updateScopeItemAction({ scopeItemId: item.id, priority });
      if (!res.ok && res.error) setMessage(res.error);
      router.refresh();
    });
  }

  return (
    <div className="repo-selector">
      <div className="repo-selector__head">
        <div className="repo-selector__account">
          <SourceIcon system={system} />
          <div>
            <p className="repo-selector__org">{copy.heading}</p>
            <p className="integration__kind">
              {display.length} available · {activeCount} active
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={runSync}
          disabled={pending || activeCount === 0}
          title={activeCount === 0 ? `Activate a ${copy.singular} first` : "Sync now"}
        >
          {pending ? "Working…" : "Sync now"}
        </button>
      </div>

      <p className="scaffold-note" style={{ marginBottom: "var(--space-md)" }}>
        {copy.scopeNote}
      </p>

      {message ? (
        <p className="form-message form-message--ok" role="status" style={{ marginBottom: "var(--space-md)" }}>
          {message}
        </p>
      ) : null}

      {display.length === 0 ? (
        <div className="empty">
          <p className="empty__title">No {copy.plural} found</p>
          <p className="empty__body">Reconnect, or check the granted scopes.</p>
        </div>
      ) : (
        <ul className="repo-list">
          {display.map((item) => (
            <li key={item.id} className={`repo-row${item.isActive ? " repo-row--active" : ""}`}>
              <div className="repo-row__main">
                <p className="repo-row__name">{item.name ?? item.externalId}</p>
                <p className="repo-row__meta mono">
                  {item.isActive
                    ? `active · ${item.includeInDailyMemo ? "memo on" : "muted"} · ${item.priority} · last sync ${formatSync(item.lastSyncAt)}`
                    : "not synced"}
                </p>
              </div>
              <div className="repo-row__controls">
                {system === "slack" || system === "discord" ? (
                  <>
                    <Toggle
                      pressed={item.includeInDailyMemo}
                      onChange={(checked) => setMemoInclusion(item, checked)}
                      label={`Include ${item.name ?? copy.singular} in Daily Memo`}
                      disabled={pending}
                    />
                    <select
                      aria-label={`Priority for ${item.name ?? copy.singular}`}
                      value={item.priority}
                      onChange={(e) => setPriority(item, e.target.value === "high" ? "high" : "normal")}
                      disabled={pending}
                      className="input select"
                      style={{ height: "34px", minWidth: "112px", padding: "0 8px" }}
                    >
                      <option value="normal">Normal</option>
                      <option value="high">Important</option>
                    </select>
                  </>
                ) : null}
                <Toggle
                  pressed={item.isActive}
                  onChange={() => toggle(item)}
                  label={`Sync ${item.name ?? copy.singular}`}
                  disabled={pending}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
