/**
 * Person detail — who they are, why they matter, how they connect, what's next.
 * Server Component: tenant-gated (RLS). Loads the person (with correlated
 * signals, including archived records so they can be restored), their
 * confirmed/suggested relationships from the graph, and the people/companies
 * they can be linked to. Viewers browse read-only; permanent deletion is
 * privileged.
 * Governance: docs/product/people-and-companies.md.
 */

import { notFound } from "next/navigation";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { isPrivilegedRole } from "@/modules/shared/tenant-context";
import { listPeople } from "@/modules/people/people-server";
import { listRelationshipsFor } from "@/modules/people/relationships";
import { listCompanies } from "@/modules/companies/companies-server";
import { PersonDetail } from "@/components/people/person-detail";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenantContext();

  const [people, companies, relationships] = await Promise.all([
    listPeople({ includeArchived: true }),
    listCompanies(),
    listRelationshipsFor("person", id, { includeSuggested: true }),
  ]);
  const person = people.find((p) => p.id === id);
  if (!person) notFound();

  return (
    <PersonDetail
      person={person}
      relationships={relationships}
      companies={companies}
      people={people.filter((p) => !p.archivedAt)}
      canManage={ctx.role !== "viewer"}
      canDelete={isPrivilegedRole(ctx.role)}
    />
  );
}
