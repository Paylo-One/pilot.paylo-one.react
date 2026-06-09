"use client";

/**
 * components/sources/whatsapp-contact-selector.tsx
 *
 * Search the session's chats/contacts and approve specific people or chats to
 * monitor. Reinforces the principle: monitor selected people or chats only —
 * never everything. Scaffold: chats are mock; approving adds a local monitor.
 */

import { useMemo, useState } from "react";
import type { WhatsAppChat } from "@/modules/source-connection/whatsapp.types";

export function WhatsAppContactSelector({
  chats,
  monitoredChatIds,
  onApprove,
}: {
  chats: readonly WhatsAppChat[];
  monitoredChatIds: ReadonlySet<string>;
  onApprove: (chat: WhatsAppChat) => void;
}) {
  const [query, setQuery] = useState("");

  const available = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chats.filter(
      (c) => !monitoredChatIds.has(c.id) && (q === "" || c.name.toLowerCase().includes(q)),
    );
  }, [chats, monitoredChatIds, query]);

  return (
    <div>
      <div className="source-search source-search--inset">
        <span className="source-search__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.2-3.2" />
          </svg>
        </span>
        <input
          type="search"
          className="input source-search__input"
          placeholder="Search contacts and chats…"
          value={query}
          aria-label="Search WhatsApp contacts and chats"
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="source-search__count mono">{available.length} found</span>
      </div>

      {available.length === 0 ? (
        <p className="empty__body" style={{ marginTop: "var(--space-md)" }}>
          No more chats to add{query ? " for that search" : ""}.
        </p>
      ) : (
        <ul className="repo-list">
          {available.map((chat) => (
            <li key={chat.id} className="repo-row">
              <div className="repo-row__main">
                <div className="repo-row__id">
                  <p className="repo-row__name">{chat.name}</p>
                  <span className="badge">{chat.kind}</span>
                  {chat.kind === "group" ? (
                    <span className="repo-row__meta mono">{chat.participantCount} people</span>
                  ) : null}
                </div>
              </div>
              <div className="repo-row__controls">
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => onApprove(chat)}>
                  Monitor
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
