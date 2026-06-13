"use client";

/**
 * Beta invitations card (every beta user). Shows how many invitations are left,
 * lets the user invite someone by email, and lists the invitations they have
 * sent with a clear status. Because invitation email delivery is not wired yet,
 * each pending invitation exposes its shareable link to copy. Sending and
 * revoking go through the Settings server actions.
 */

import { useActionState, useEffect, useRef, useState } from "react";
import {
  sendInvitationAction,
  revokeInvitationAction,
} from "./invitation-actions";
import {
  initialInvitationFormState,
  INVITATION_STATUS_LABELS,
  INVITATION_STATUS_TONE,
  type InvitationView,
} from "./invitation-types";

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : dateFormat.format(parsed);
}

export function InvitationsCard({
  allowance,
  invitations,
}: {
  allowance: { total: number; used: number; remaining: number };
  invitations: InvitationView[];
}) {
  const [state, action, pending] = useActionState(
    sendInvitationAction,
    initialInvitationFormState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (state.status === "ok") formRef.current?.reset();
  }, [state]);

  const noneLeft = allowance.remaining <= 0;

  async function copyLink(view: InvitationView) {
    try {
      await navigator.clipboard.writeText(view.link);
      setCopiedId(view.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard can be blocked; the link is visible in the title attribute.
    }
  }

  return (
    <>
      <p
        className="action-card__rationale"
        style={{ marginBottom: "var(--space-md)" }}
      >
        You have{" "}
        <strong>
          {allowance.remaining} of {allowance.total}
        </strong>{" "}
        invitations left. Invite someone by email; they will get a private link
        to set up their own workspace. You can revoke a pending invitation to
        free up a slot.
      </p>

      <form ref={formRef} action={action} className="input-suffix">
        <input
          name="email"
          type="email"
          required
          disabled={noneLeft || pending}
          className="input"
          placeholder="name@company.com"
          aria-label="Email address to invite"
        />
        <button
          type="submit"
          className="btn btn--primary"
          disabled={noneLeft || pending}
        >
          {pending ? "Sending…" : "Send invite"}
        </button>
      </form>

      {state.status === "error" && state.message ? (
        <p className="form-message form-message--error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === "ok" && state.message ? (
        <p className="form-message form-message--ok" role="status">
          {state.message}
        </p>
      ) : null}
      {noneLeft ? (
        <p className="field__hint" style={{ marginTop: "var(--space-sm)" }}>
          All invitations are in use. Revoke a pending one below to invite
          someone else.
        </p>
      ) : null}

      <div style={{ marginTop: "var(--space-lg)" }}>
        {invitations.length === 0 ? (
          <div className="empty">
            <p className="empty__title">No invitations yet</p>
            <p className="empty__body">
              When you invite someone, it will appear here so you can track
              whether it is still pending or has been accepted.
            </p>
          </div>
        ) : (
          <div className="stack" style={{ gap: 0 }}>
            {invitations.map((inv) => (
              <div className="meta-row" key={inv.id}>
                <span className="meta-row__key" style={{ minWidth: 0 }}>
                  <span style={{ color: "var(--colour-text-primary)" }}>
                    {inv.email}
                  </span>
                  <span
                    className="mono"
                    style={{
                      display: "block",
                      fontSize: "var(--text-label)",
                      color: "var(--colour-text-tertiary)",
                    }}
                  >
                    {inv.status === "pending"
                      ? `Sent ${formatDate(inv.createdAt)} · expires ${formatDate(inv.expiresAt)}`
                      : `Sent ${formatDate(inv.createdAt)}`}
                  </span>
                </span>
                <span
                  className="meta-row__value"
                  style={{
                    display: "flex",
                    gap: "var(--space-sm)",
                    alignItems: "center",
                    flexWrap: "wrap",
                    justifyContent: "flex-end",
                  }}
                >
                  <span className={`status status--${INVITATION_STATUS_TONE[inv.status]}`}>
                    {INVITATION_STATUS_LABELS[inv.status]}
                  </span>
                  {inv.status === "pending" ? (
                    <>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => copyLink(inv)}
                        title={inv.link}
                      >
                        {copiedId === inv.id ? "Copied" : "Copy link"}
                      </button>
                      <form action={revokeInvitationAction}>
                        <input type="hidden" name="id" value={inv.id} />
                        <button type="submit" className="btn btn--ghost btn--sm">
                          Revoke
                        </button>
                      </form>
                    </>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
