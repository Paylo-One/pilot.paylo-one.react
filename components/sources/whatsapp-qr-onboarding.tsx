"use client";

/**
 * components/sources/whatsapp-qr-onboarding.tsx
 *
 * QR onboarding placeholder for a tenant-scoped WhatsApp session. Scaffold only:
 * renders a placeholder QR and the linked-device steps. NO real QR is generated,
 * NO session is established, NO credentials are stored. The connection approach
 * (Business Platform vs Web-session bridge vs export/import) must be validated
 * before production (architecture/whatsapp-session-architecture.md).
 */

export function WhatsAppQrOnboarding({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="wa-qr">
      <div className="wa-qr__code" aria-hidden="true">
        QR
        <br />
        placeholder
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
        <p className="scaffold-note" style={{ marginTop: "var(--space-sm)" }}>
          Scaffold — no real QR or session. The session is tenant-scoped and only
          monitors approved people or chats. Approach pending validation.
        </p>
        <button type="button" className="btn btn--ghost btn--sm" style={{ marginTop: "var(--space-sm)" }} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
