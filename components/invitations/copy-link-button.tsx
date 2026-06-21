"use client";

/**
 * components/invitations/copy-link-button.tsx
 *
 * The single copy control for a user's private invitation link. Shared by the
 * Invitations page, the Settings summary, and the briefing strip so the copy
 * behaviour (and its disabled state when the link is unavailable) lives in one
 * place. Falls back gracefully when the clipboard API is blocked — the full
 * link is always present in the title attribute.
 */

import { useState } from "react";

export function CopyLinkButton({
  link,
  disabled = false,
  className = "btn btn--primary",
  idleLabel = "Copy invitation link",
  copiedLabel = "Copied",
}: {
  link: string;
  disabled?: boolean;
  className?: string;
  idleLabel?: string;
  copiedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the full link is in the title attribute.
    }
  }

  return (
    <button
      type="button"
      className={className}
      onClick={copy}
      disabled={disabled}
      title={link}
    >
      {copied ? copiedLabel : idleLabel}
    </button>
  );
}
