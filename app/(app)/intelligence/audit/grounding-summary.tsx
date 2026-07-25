/**
 * A calm, read-only summary of how grounded Pilot's AI output has been over the
 * last 30 days: how much it kept because it was tied to a real source, and how
 * much it held back because it was not. This is the operator-visible evidence
 * that the trust contract ("nothing is shown unless it can be traced to your
 * sources") is actively working — not a metrics dashboard. Counts only; no
 * content. Copy stays plain: no "attribution", "dropped", or "unattributed".
 */

import type { AttributionCoverageSummary } from "@/modules/agent-orchestration/attribution-coverage";

export function GroundingSummary({
  summary,
}: {
  summary: AttributionCoverageSummary;
}) {
  const total = summary.kept + summary.withheld;
  const groundedPct = Math.round(summary.coverageRate * 100);
  const heldBack = summary.byAgent.filter((a) => a.withheld > 0);

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card__title">Grounded in your sources</h2>
        {total > 0 ? (
          <span className="status status--ok">{groundedPct}% grounded</span>
        ) : null}
      </div>

      <p className="page-head__lead" style={{ marginTop: 0 }}>
        Pilot only shows an AI-suggested insight when it can tie it back to
        something real in your connected sources. Anything it cannot, it holds
        back — so what you see is always traceable.
      </p>

      {total === 0 ? (
        <p className="scaffold-note">
          Pilot hasn’t produced any AI suggestions in the last 30 days yet. When
          it does, you’ll see how much it kept and how much it held back here.
        </p>
      ) : (
        <div className="stack" style={{ gap: "var(--space-sm)" }}>
          <div className="meta-row">
            <span className="meta-row__key">Kept (tied to a source)</span>
            <span className="meta-row__value">{summary.kept}</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Held back (no clear source)</span>
            <span className="meta-row__value">{summary.withheld}</span>
          </div>
          {heldBack.length > 0 ? (
            <div
              className="stack"
              style={{
                gap: "var(--space-xs)",
                marginTop: "var(--space-xs)",
                paddingTop: "var(--space-sm)",
                borderTop: "1px solid var(--colour-border)",
              }}
            >
              <span className="text-tertiary" style={{ fontSize: "0.85em" }}>
                Held back by area, last 30 days
              </span>
              {heldBack.map((a) => (
                <div className="meta-row" key={a.agent}>
                  <span className="meta-row__key">{a.agent}</span>
                  <span className="meta-row__value">{a.withheld}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
