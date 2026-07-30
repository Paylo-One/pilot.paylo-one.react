/**
 * Company detail — the organisation behind the activity. Server Component:
 * tenant-gated (RLS). Loads the full company view (people, connections,
 * domains, aliases, recent activity matched by domain) plus the directory
 * lists that power relationship management. Archived companies still resolve
 * so they can be restored. Viewers browse read-only; permanent deletion is
 * privileged.
 * Governance: docs/services/company-context-service.md, docs/product/people-and-companies.md.
 */

import { notFound } from "next/navigation";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { isPrivilegedRole } from "@/modules/shared/tenant-context";
import { getCompanyDetail, listCompanies } from "@/modules/companies/companies-server";
import { listPeopleDirectory } from "@/modules/people/people-server";
import { CompanyDetail } from "@/components/companies/company-detail";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenantContext();

  const [company, people, companies] = await Promise.all([
    getCompanyDetail(id),
    listPeopleDirectory(),
    listCompanies(),
  ]);
  if (!company) notFound();

  return (
    <CompanyDetail
      company={company}
      people={people}
      companies={companies}
      canManage={ctx.role !== "viewer"}
      canDelete={isPrivilegedRole(ctx.role)}
    />
  );
}
