/**
 * Invitations — an honest holding surface while acceptance is unavailable.
 *
 * Governance: product/access-and-invitations.md.
 */

export const metadata = {
  title: "Invitations",
};

export default async function InvitationsPage() {
  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">Invitations</p>
        <h1 className="page-head__title">Invitations are paused</h1>
        <p className="page-head__lead">
          We are completing secure invitation acceptance and workspace
          membership before issuing new links. Existing links cannot be accepted
          yet, so please do not share them.
        </p>
      </div>

      <section className="card card--planned" style={{ maxWidth: "680px" }}>
        <div className="card-head">
          <div>
            <p className="eyebrow">Workspace access</p>
            <h2 className="card__title">What happens next</h2>
          </div>
          <span className="status status--info">Planned</span>
        </div>
        <p className="action-card__rationale">
          Invitation controls will return when a recipient can verify the invited
          email, join with a least-privileged role, and recover safely from an
          expired or invalid link.
        </p>
      </section>
    </main>
  );
}
