/**
 * Company detail — the organisation behind the activity. Server Component:
 * tenant-gated (RLS). Loads the full company view: people, connections, domains,
 * aliases, and recent activity matched by domain.
 * Governance: docs/services/company-context-service.md, docs/product/people-and-companies.md.
 */

import { notFound } from "next/navigation";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { getCompanyDetail } from "@/modules/companies/companies-server";
import { CompanyDetail } from "@/components/companies/company-detail";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireTenantContext();

  const company = await getCompanyDetail(id);
  if (!company) notFound();

  return <CompanyDetail company={company} />;
}
