"use client";

/**
 * components/sources/whatsapp-qr-onboarding.tsx
 *
 * QR onboarding for a tenant-scoped WhatsApp session (ADR-036).
 *
 *  - Bridge ON: polls the live session for the short-lived QR (a data URL) and
 *    renders it; when the device links (status → connected) it refreshes the
 *    workspace. The QR is transient — never persisted.
 *  - Bridge OFF: renders the scaffold placeholder QR and the linked-device steps;
 *    no real QR is generated and no session is established.
 *
 * The code box renders one of four explicit states — loading (waiting for the
 * bridge to mint a QR), ready (live QR on a white quiet zone), expired
 * (session lapsed before the scan), error (bridge unreachable) — so the
 * operator always knows what is happening. The QR is only ever shown inside
 * the authenticated workspace (SR-36).
 */

import { useEffect, useRef, useState } from "react";
import { getWhatsAppSessionStatusAction } from "@/app/(app)/sources/actions";
import type { WhatsAppSessionStatus } from "@/modules/source-connection/whatsapp.types";

const POLL_MS = 2500;

type QrPhase = "loading" | "ready" | "expired" | "error" | "scaffold";

export function WhatsAppQrOnboarding({
  bridgeEnabled,
  onCancel,
  onConnected,
}: {
  bridgeEnabled: boolean;
  onCancel: () => void;
  onConnected: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState<WhatsAppSessionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connectedRef = useRef(false);

  useEffect(() => {
    if (!bridgeEnabled) return;
    let cancelled = false;

    async function poll() {
      const res = await getWhatsAppSessionStatusAction();
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setQr(res.qr);
      setStatus(res.status);
      if (res.status === "connected" && !connectedRef.current) {
        connectedRef.current = true;
        onConnected();
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [bridgeEnabled, onConnected]);

  const phase: QrPhase = !bridgeEnabled
    ? "scaffold"
    : error
      ? "error"
      : status === "expired" || status === "needs_reconnect"
        ? "expired"
        : qr
          ? "ready"
          : "loading";

  return (
    <div className="wa-qr">
      <div
        className={`wa-qr__code${phase === "ready" ? " wa-qr__code--live" : ""}`}
        aria-hidden={phase !== "ready"}
      >
        {phase === "ready" && qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="WhatsApp linking QR code" />
        ) : phase === "loading" ? (
          <>
            generating
            <br />
            QR code…
          </>
        ) : phase === "expired" ? (
          <>
            code
            <br />
            expired
          </>
        ) : phase === "error" ? (
          <>
            bridge
            <br />
            unavailable
          </>
        ) : (
          <>
            QR
            <br />
            placeholder
          </>
        )}
      </div>
      <div className="wa-qr__body">
        <p className="memo-item__title">Link a device to this workspace</p>
        <ol className="steps" style={{ marginTop: "var(--space-sm)" }}>
          <li className="step">
            <span className="step__no">1</span>
            <span className="step__body">Open WhatsApp → Settings → Linked devices.</span>
          </li>
          <li className="step">
            <span className="step__no">2</span>
            <span className="step__body">Tap “Link a device” and scan this code.</span>
          </li>
          <li className="step">
            <span className="step__no">3</span>
            <span className="step__body">
              Choose the people or chats to monitor — nothing is read until you approve it.
            </span>
          </li>
        </ol>
        {phase === "expired" ? (
          <p className="scaffold-note" style={{ marginTop: "var(--space-sm)" }}>
            This code expired before it was scanned. Cancel, then start the
            session again to generate a fresh one.
          </p>
        ) : phase === "error" ? (
          <p className="scaffold-note" style={{ marginTop: "var(--space-sm)" }}>
            The Web-session bridge is not responding{error ? ` (${error})` : ""}.
            It keeps retrying automatically — or cancel and try again later.
          </p>
        ) : phase === "scaffold" ? (
          <p className="scaffold-note" style={{ marginTop: "var(--space-sm)" }}>
            Scaffold — no real QR or session. The session is tenant-scoped and only
            monitors approved people or chats. Bridge disabled.
          </p>
        ) : (
          <p className="scaffold-note" style={{ marginTop: "var(--space-sm)" }}>
            Live QR — short-lived and bound to this workspace. The session is
            tenant-scoped and only monitors approved people or chats.
          </p>
        )}
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          style={{ marginTop: "var(--space-md)" }}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
