/**
 * Actions — Screen 2, the suggested-actions queue. product/actions.md.
 *
 * Server Component: lists the tenant's actions via the USER server client (RLS
 * active), each with rationale, confidence, and source references. The operator
 * approves / edits / dismisses / defers; nothing is ever sent autonomously —
 * decisions change status only. Suggested actions awaiting a decision are
 * separated from confirmed/decided ones.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import {
  listSuggestedActions,
  type SuggestedActionView,
} from "@/modules/action-extraction/server";
import { ActionControls } from "./action-controls";
import { RefinementActions } from "@/components/refinement/refinement-actions";
import { PersonLinkControl } from "@/components/refinement/person-link-control";

/** Representative confidence for an action, from its source references. */
function actionConfidence(action: SuggestedActionView): number | null {
  const values = action.references
    .map((r) => r.confidence)
    .filter((c): c is number => typeof c === "number");
  if (values.length === 0) return null;
  return Math.max(...values);
}

function SourceRefs({ action }: { action: SuggestedActionView }) {
  if (action.references.length === 0) return null;
  return (
    <div className="source-ref-row">
      {action.references.map((ref) => (
        <span
          key={ref.id}
          className="source-ref"
          title={ref.excerptOrPointer ?? undefined}
        >
          <span className="source-ref__system">{ref.sourceSystem}</span>
          {typeof ref.confidence === "number" ? (
            <span className="source-ref__confidence">
              {Math.round(ref.confidence * 100)}%
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function ActionCard({ action }: { action: SuggestedActionView }) {
  const confidence = actionConfidence(action);
  return (
    <article className="action-card">
      <div className="action-card__head">
        <div style={{ minWidth: 0 }}>
          <h3 className="action-card__title">{action.title}</h3>
          {action.rationale ? (
            <p className="action-card__rationale">{action.rationale}</p>
          ) : null}
        </div>
        <ActionControls actionId={action.id} status={action.status} />
      </div>
      <div className="action-card__footer">
        <SourceRefs action={action} />
        {confidence !== null ? (
          <span className="confidence" title="Model-assigned confidence">
            Confidence
            <span className="confidence__track">
              <span
                className="confidence__fill"
                style={{ width: `${Math.round(confidence * 100)}%` }}
              />
            </span>
            {Math.round(confidence * 100)}%
          </span>
        ) : null}
      </div>
      <div className="action-card__footer">
        <PersonLinkControl targetId={action.id} />
        <RefinementActions
          targetType="action"
          targetId={action.id}
          feedback={["not_relevant", "lower_priority", "do_not_show_again"]}
        />
      </div>
    </article>
  );
}

export default async function ActionsPage() {
  const ctx = await requireTenantContext();
  const actions = await listSuggestedActions(ctx.tenantId);

  const suggested = actions.filter((a) => a.status === "suggested");
  const decided = actions.filter((a) => a.status !== "suggested");

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">Actions</p>
        <h1 className="page-head__title">Suggested actions</h1>
        <p className="page-head__lead">
          Candidate actions extracted from your context, each with its rationale
          and source. You approve, edit, defer, or dismiss — the system prepares
          the work; you remain the one who acts.
        </p>
      </div>

      {actions.length === 0 ? (
        <>
          <div className="empty" style={{ marginBottom: "var(--space-lg)" }}>
            <p className="empty__title">No suggested actions yet</p>
            <p className="empty__body">
              Generate a Daily Memo and candidate actions extracted from your
              channels will queue here for your decision.
            </p>
          </div>

          {/* Illustrative anatomy of a suggested action (non-interactive). */}
          <p className="eyebrow" style={{ marginBottom: "var(--space-sm)" }}>
            How a suggestion reads
          </p>
          <article className="action-card" aria-hidden="true">
            <div className="action-card__head">
              <div style={{ minWidth: 0 }}>
                <h3 className="action-card__title">
                  Reply to Thunes with a holding position on failover
                </h3>
                <p className="action-card__rationale">
                  An incident notice asked for a response today; this is prepared
                  for your review, not sent.
                </p>
              </div>
              <div className="action-controls">
                <span className="btn btn--accent-outline" style={{ opacity: 0.6 }}>
                  Approve
                </span>
                <span className="btn btn--ghost" style={{ opacity: 0.6 }}>
                  Edit
                </span>
                <span className="btn btn--ghost" style={{ opacity: 0.6 }}>
                  Defer
                </span>
                <span className="btn btn--ghost" style={{ opacity: 0.6 }}>
                  Dismiss
                </span>
              </div>
            </div>
            <div className="action-card__footer">
              <div className="source-ref-row">
                <span className="chip chip--accent">Linked: Jacques Becker</span>
                <span className="source-ref">
                  <span className="source-ref__system">Email</span>
                  <span aria-hidden="true">·</span>
                  <span>06:12</span>
                  <span className="source-ref__confidence">90%</span>
                </span>
              </div>
              <span className="confidence">
                Confidence
                <span className="confidence__track">
                  <span className="confidence__fill" style={{ width: "90%" }} />
                </span>
                90%
              </span>
            </div>
          </article>
        </>
      ) : (
        <div className="stack" style={{ gap: "var(--space-xl)" }}>
          <section>
            <div className="card-head">
              <p className="eyebrow">Awaiting your decision</p>
              <span className="badge">{suggested.length}</span>
            </div>
            {suggested.length === 0 ? (
              <div className="empty">
                <p className="empty__title">Queue clear</p>
                <p className="empty__body">
                  Nothing is awaiting a decision right now.
                </p>
              </div>
            ) : (
              <div className="stack">
                {suggested.map((action) => (
                  <ActionCard key={action.id} action={action} />
                ))}
              </div>
            )}
          </section>

          {decided.length > 0 ? (
            <section>
              <div className="card-head">
                <p className="eyebrow">Confirmed &amp; decided</p>
                <span className="badge">{decided.length}</span>
              </div>
              <div className="stack">
                {decided.map((action) => (
                  <ActionCard key={action.id} action={action} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}

      <p className="scaffold-note" style={{ marginTop: "var(--space-lg)" }}>
        Nothing is ever sent for you. Approving, deferring, or dismissing only
        changes an item&rsquo;s status here, and every change is recorded.
      </p>
    </main>
  );
}
