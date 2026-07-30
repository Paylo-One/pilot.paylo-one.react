/**
 * People & Companies — the relationship intelligence layer. Manage the people and
 * companies Pilot correlates information with across sources (email, Teams,
 * WhatsApp, GitHub, diary…), so fragmented signals become an understanding of who
 * matters, why, and how they connect.
 *
 * Server Component: gated by tenant context (RLS shell). Loads the directory
 * (active + archived, with correlated signals), the correlation inbox, a small
 * curated set of relationship suggestions (the full backlog stays behind
 * "View more"), and the confirmed relationship network for the Connections tab.
 * Viewers browse read-only; permanent deletion is privileged.
 * Governance: docs/product/people-and-companies.md.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import { isPrivilegedRole } from "@/modules/shared/tenant-context";
import { listPeople, listLinkSuggestions } from "@/modules/people/people-server";
import { getCuratedSuggestions, getPeopleNetwork } from "@/modules/people/relationships";
import { detectDuplicatePeople } from "@/modules/people/correlation";
import { listCompanies } from "@/modules/companies/companies-server";
import { PeopleSurface } from "@/components/people/people-surface";

export default async function PeoplePage() {
  const ctx = await requireTenantContext();
  const [allPeople, allCompanies, identitySuggestions, suggestions, network] = await Promise.all([
    listPeople({ includeArchived: true }),
    listCompanies({ includeArchived: true }),
    listLinkSuggestions(),
    getCuratedSuggestions(),
    getPeopleNetwork(),
  ]);
  const people = allPeople.filter((p) => !p.archivedAt);
  const archivedPeople = allPeople.filter((p) => p.archivedAt);
  const companies = allCompanies.filter((c) => !c.archivedAt);
  const archivedCompanies = allCompanies.filter((c) => c.archivedAt);
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
        archivedPeople={archivedPeople}
        companies={companies}
        archivedCompanies={archivedCompanies}
        identitySuggestions={identitySuggestions}
        duplicates={duplicates}
        suggestions={suggestions}
        network={network}
        canManage={ctx.role !== "viewer"}
        canDelete={isPrivilegedRole(ctx.role)}
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
