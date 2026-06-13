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
        People, and the way their accounts across different tools are linked, stay
        private to your workspace. “Run correlation” looks at your recent items and
        matches them to the right person: confident matches become signals, and
        anything uncertain becomes a “same person?” suggestion for you to confirm.
        Nothing is ever merged for you — you confirm every link, and once you do,
        future items match automatically.
      </p>
    </main>
  );
}
