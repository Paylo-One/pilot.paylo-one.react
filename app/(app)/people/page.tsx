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
import { listPeople, listLinkSuggestions } from "@/modules/people/people-server";
import { PeopleBrowser } from "./people-browser";

export default async function PeoplePage() {
  await requireTenantContext();
  const [people, suggestions] = await Promise.all([listPeople(), listLinkSuggestions()]);

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

      <PeopleBrowser people={people} suggestions={suggestions} />

      <p className="scaffold-note" style={{ marginTop: "var(--space-xl)" }}>
        People, their cross-source identities, and correlation are persisted and
        tenant-scoped. “Run correlation” resolves recent ingested items to people
        by their verified identities: confident matches become signals; uncertain
        ones become confirmable “same person?” suggestions. The system never
        silently merges people — every link is confirmable, and confirming locks
        a verified identity so future items resolve automatically.
      </p>
    </main>
  );
}
