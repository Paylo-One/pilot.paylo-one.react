"use client";

/**
 * components/sources/whatsapp-contact-selector.tsx
 *
 * Search the session's chats/contacts and approve specific people or chats to
 * monitor. Reinforces the principle: monitor selected people or chats only —
 * never everything.
 *
 * Discovery is paginated: the component fetches pages from the server action
 * (which pages the bridge's full index) and the search box queries that full
 * index server-side — so a chat beyond the current page is still findable.
 * "Load more" walks deeper into the list, named chats first.
 */

import { useEffect, useState } from "react";
import { getWhatsAppChatsAction } from "@/app/(app)/sources/actions";
import {
  formatWhatsAppChatLabel,
  isWhatsAppChatNamed,
  type WhatsAppChat,
} from "@/modules/source-connection/whatsapp.types";

const PAGE_SIZE = 60;
const SEARCH_DEBOUNCE_MS = 300;

export function WhatsAppContactSelector({
  monitoredChatIds,
  onApprove,
}: {
  monitoredChatIds: ReadonlySet<string>;
  onApprove: (chat: WhatsAppChat) => void;
}) {
  const [query, setQuery] = useState("");
  const [chats, setChats] = useState<WhatsAppChat[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Page 0 on mount and (debounced) whenever the query changes. The query is
  // applied server-side over the bridge's full index.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        setLoading(true);
        getWhatsAppChatsAction(query, 0, PAGE_SIZE).then((res) => {
          if (cancelled) return;
          setLoading(false);
          if (res.ok) {
            setChats(res.chats);
            setTotal(res.total);
            setError(null);
          } else {
            setError(res.error);
          }
        });
      },
      query.trim() ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  function loadMore() {
    setLoadingMore(true);
    getWhatsAppChatsAction(query, chats.length, PAGE_SIZE).then((res) => {
      setLoadingMore(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setTotal(res.total);
      setChats((prev) => [
        ...prev,
        ...res.chats.filter((c) => !prev.some((p) => p.id === c.id)),
      ]);
    });
  }

  const available = chats.filter((c) => !monitoredChatIds.has(c.id));
  const hasMore = chats.length < total;

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
          placeholder="Search all contacts and chats…"
          value={query}
          aria-label="Search WhatsApp contacts and chats"
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="source-search__count mono">
          {loading ? "searching…" : `${total} found`}
        </span>
      </div>

      {error ? (
        <p className="empty__body" style={{ marginTop: "var(--space-md)" }}>
          Discovery failed: {error}
        </p>
      ) : null}

      {!loading && available.length === 0 ? (
        <p className="empty__body" style={{ marginTop: "var(--space-md)" }}>
          No more chats to add{query ? " for that search" : ""}.
        </p>
      ) : (
        <ul className="repo-list">
          {available.map((chat) => {
            const named = isWhatsAppChatNamed(chat.name, chat.id);
            return (
            <li key={chat.id} className="repo-row">
              <div className="repo-row__main">
                <div className="repo-row__id">
                  <p className="repo-row__name">
                    {formatWhatsAppChatLabel(chat.name, chat.id, chat.kind)}
                  </p>
                  <span className="badge">{chat.kind}</span>
                  {chat.kind === "group" && chat.participantCount > 0 ? (
                    <span className="repo-row__meta mono">{chat.participantCount} people</span>
                  ) : null}
                </div>
                {/* Unnamed groups keep their id visible so they stay tellable-apart. */}
                {!named && chat.kind === "group" ? (
                  <p className="repo-row__meta mono">{chat.id.split("@")[0]}</p>
                ) : null}
              </div>
              <div className="repo-row__controls">
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => onApprove(chat)}>
                  Monitor
                </button>
              </div>
            </li>
            );
          })}
        </ul>
      )}

      {hasMore ? (
        <div style={{ marginTop: "var(--space-md)", display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={loadingMore}
            onClick={loadMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
          <span className="repo-row__meta mono">
            showing {chats.length} of {total}
          </span>
        </div>
      ) : null}
    </div>
  );
}
