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
 * The QR is only ever shown inside the authenticated workspace (SR-36).
 */

import { useEffect, useRef, useState } from "react";
import { getWhatsAppSessionStatusAction } from "@/app/(app)/sources/actions";

const POLL_MS = 2500;

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

  return (
    <div className="wa-qr">
      <div className="wa-qr__code" aria-hidden={!qr}>
        {bridgeEnabled && qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="WhatsApp linking QR code" width={160} height={160} />
        ) : bridgeEnabled ? (
          <>
            waiting
            <br />
            for QR…
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
        {bridgeEnabled ? (
          <p className="scaffold-note" style={{ marginTop: "var(--space-sm)" }}>
            Live QR — short-lived and bound to this workspace. The session is
            tenant-scoped and only monitors approved people or chats.
            {error ? ` Bridge: ${error}` : ""}
          </p>
        ) : (
          <p className="scaffold-note" style={{ marginTop: "var(--space-sm)" }}>
            Scaffold — no real QR or session. The session is tenant-scoped and only
            monitors approved people or chats. Bridge disabled.
          </p>
        )}
        <button type="button" className="btn btn--ghost btn--sm" style={{ marginTop: "var(--space-sm)" }} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
