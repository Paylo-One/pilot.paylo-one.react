/**
 * People & Companies — the relationship intelligence layer. Manage the people and
 * companies Pilot correlates information with across sources (email, Teams,
 * WhatsApp, GitHub, diary…), so fragmented signals become an understanding of who
 * matters, why, and how they connect.
 *
 * Server Component: gated by tenant context (RLS shell). Loads people (with
 * correlated signals), companies, and the correlation inbox (identity matches,
 * proposed links, possible duplicates).
 * Governance: docs/product/people-and-companies.md.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import { listPeople, listLinkSuggestions } from "@/modules/people/people-server";
import { listSuggestedLinks } from "@/modules/people/relationships";
import { detectDuplicatePeople } from "@/modules/people/correlation";
import { listCompanies } from "@/modules/companies/companies-server";
import { PeopleSurface } from "@/components/people/people-surface";

export default async function PeoplePage() {
  await requireTenantContext();
  const [people, companies, identitySuggestions, suggestedLinks] = await Promise.all([
    listPeople(),
    listCompanies(),
    listLinkSuggestions(),
    listSuggestedLinks(),
  ]);
  const duplicates = detectDuplicatePeople(people);

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">People &amp; companies</p>
        <h1 className="page-head__title">Your relationship layer</h1>
        <p className="page-head__lead">
          The people and companies behind your work. Pilot links emails, messages,
          pull requests, diary notes, and actions to the people and organisations
          they involve, so you can see who matters, why, and how they connect. You
          stay in control: confirm, correct, and refine every link.
        </p>
      </div>

      <PeopleSurface
        people={people}
        companies={companies}
        identitySuggestions={identitySuggestions}
        suggestedLinks={suggestedLinks}
        duplicates={duplicates}
      />

      <p className="scaffold-note" style={{ marginTop: "var(--space-xl)" }}>
        People, companies, and the way their accounts across tools connect stay
        private to your workspace. Run correlation to match recent activity to the
        right person or company: confident matches attach quietly, and anything
        uncertain waits for you in Needs review. Nothing is ever merged or linked
        for you.
      </p>
    </main>
  );
}
