/**
 * Tool Layer — a planned surface. When it is switched on, Paylo.one will be able
 * to use a small set of approved tools to gather context for you, under clear
 * rules. It is not open yet, so this page explains what is coming rather than
 * exposing an unfinished flow. The navigation entry for it is disabled until it
 * is available. Governance: governance/docs/product/release-readiness.md.
 */

import { AVAILABILITY_LABELS } from "@/modules/shared/availability";

const CAPABILITIES = [
  {
    title: "Read-only by default",
    body: "Tools that only look things up run quietly in the background and are always logged, so you can see exactly what was used and when.",
  },
  {
    title: "Your approval before any change",
    body: "Anything that would send, post, or change something is held for your explicit approval. Nothing acts on your behalf without you.",
  },
  {
    title: "Private to your workspace",
    body: "Tools are limited to your workspace, and anything they return is treated as information to consider, never as instructions to follow.",
  },
];

export default function ToolLayerPage() {
  return (
    <main className="workspace__content">
      <div className="page-head">
        <div className="page-head__row">
          <div>
            <p className="eyebrow">Tool Layer</p>
            <h1 className="page-head__title">Tool Layer</h1>
            <p className="page-head__lead">
              A safe, approved way for Paylo.one to use outside tools to gather
              context for you, always under your control. This is on our roadmap
              and will be switched on with help during onboarding, not before.
            </p>
          </div>
          <span className="status status--info">
            {AVAILABILITY_LABELS.planned}
          </span>
        </div>
      </div>

      <div className="card card--planned">
        <div className="card-head">
          <div>
            <p className="eyebrow">What to expect</p>
            <h2 className="card__title">How the Tool Layer will work</h2>
          </div>
          <span className="status status--info">
            {AVAILABILITY_LABELS.planned}
          </span>
        </div>
        <div className="stack" style={{ gap: "var(--space-md)" }}>
          {CAPABILITIES.map((capability) => (
            <div className="meta-row" key={capability.title}>
              <span className="meta-row__key" style={{ minWidth: 0 }}>
                <span
                  style={{
                    color: "var(--colour-text-primary)",
                    fontWeight: 600,
                  }}
                >
                  {capability.title}
                </span>
                <span
                  style={{
                    display: "block",
                    color: "var(--colour-text-secondary)",
                    fontSize: "var(--text-small)",
                    marginTop: "var(--space-xs)",
                  }}
                >
                  {capability.body}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="scaffold-note" style={{ marginTop: "var(--space-lg)" }}>
        We will let you know when the Tool Layer is ready for your workspace.
        Until then, nothing here is active.
      </p>
    </main>
  );
}
