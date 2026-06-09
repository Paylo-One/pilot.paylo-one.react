/**
 * People — the relationship layer. Manage the people Paylo.one correlates
 * information with across sources (Email, Teams, WhatsApp, GitHub, diary…), so
 * fragmented signals become relationship-aware operating intelligence.
 *
 * Server Component: gated by tenant context (RLS shell). The directory itself
 * is scaffolded on typed mock data — People Context is not persisted yet.
 * Governance: architecture/people-context-architecture.md, services/people-context-service.md.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import { listPeople } from "@/modules/people/people-server";
import { PeopleBrowser } from "./people-browser";

export default async function PeoplePage() {
  await requireTenantContext();
  const people = await listPeople();

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">People</p>
        <h1 className="page-head__title">People context</h1>
        <p className="page-head__lead">
          The people behind your information. Paylo.one links emails, messages,
          pull requests, diary notes, and actions to the people they involve — so
          you can see who is connected to which decisions, projects, and risks.
          You stay in control: confirm, correct, and refine every link.
        </p>
      </div>

      <PeopleBrowser people={people} suggestions={[]} />

      <p className="scaffold-note" style={{ marginTop: "var(--space-xl)" }}>
        People and their cross-source identities are persisted and tenant-scoped.
        Correlated signals, linked actions, and “same person?” suggestions are
        produced by the correlation pipeline (not yet wired), so they appear once
        sources feed it. People Context turns fragmented information into
        relationship-aware operating intelligence; matches are always confirmable
        — the system never silently merges people.
      </p>
    </main>
  );
}
