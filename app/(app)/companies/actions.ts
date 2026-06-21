"use server";

/**
 * Company server actions. Each re-derives the trusted tenant context server-side
 * (never from client input) and writes through the RLS user client, so a tenant
 * can only ever mutate its own companies. Governance: services/company-context-service.md.
 */

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { auditService } from "@/modules/audit";
import {
  createCompany,
  updateCompany,
  deleteCompany,
  addCompanyDomain,
  removeCompanyDomain,
  addCompanyAlias,
  removeCompanyAlias,
  addCompanyTag,
  removeCompanyTag,
  type CreateCompanyInput,
  type UpdateCompanyPatch,
} from "@/modules/companies/companies-server";

type Result = { ok: boolean; error: string | null };

export async function createCompanyAction(
  input: CreateCompanyInput,
): Promise<{ ok: boolean; id?: string; error: string | null }> {
  const ctx = await requireTenantContext();
  if (!input?.name?.trim()) return { ok: false, error: "A company name is required." };
  try {
    const id = await createCompany(ctx.tenantId, input);
    await auditService.record(ctx, { action: "company.created", target: id, metadata: { name: input.name } });
    revalidatePath("/people");
    revalidatePath("/companies");
    return { ok: true, id, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Create failed." };
  }
}

export async function updateCompanyAction(input: {
  companyId: string;
  patch: UpdateCompanyPatch;
}): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!input?.companyId) return { ok: false, error: "Missing company." };
  try {
    const changed = await updateCompany(input.companyId, input.patch);
    if (changed) {
      await auditService.record(ctx, {
        action: "company.updated",
        target: input.companyId,
        metadata: input.patch as Record<string, unknown>,
      });
    }
    revalidatePath("/companies");
    revalidatePath(`/companies/${input.companyId}`);
    return { ok: changed, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Update failed." };
  }
}

export async function deleteCompanyAction(input: { companyId: string }): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!input?.companyId) return { ok: false, error: "Missing company." };
  try {
    await deleteCompany(input.companyId);
    await auditService.record(ctx, { action: "company.deleted", target: input.companyId });
    revalidatePath("/companies");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Delete failed." };
  }
}

export async function addCompanyDomainAction(input: { companyId: string; domain: string }): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!input?.companyId || !input.domain?.trim()) return { ok: false, error: "Missing domain." };
  try {
    await addCompanyDomain(ctx.tenantId, input.companyId, input.domain);
    await auditService.record(ctx, { action: "company.domain.added", target: input.companyId });
    revalidatePath(`/companies/${input.companyId}`);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Add domain failed." };
  }
}

export async function removeCompanyDomainAction(input: { companyId: string; domainId: string }): Promise<Result> {
  await requireTenantContext();
  if (!input?.domainId) return { ok: false, error: "Missing domain." };
  try {
    await removeCompanyDomain(input.domainId);
    revalidatePath(`/companies/${input.companyId}`);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Remove domain failed." };
  }
}

export async function addCompanyAliasAction(input: { companyId: string; alias: string }): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!input?.companyId || !input.alias?.trim()) return { ok: false, error: "Missing alias." };
  try {
    await addCompanyAlias(ctx.tenantId, input.companyId, input.alias);
    revalidatePath(`/companies/${input.companyId}`);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Add alias failed." };
  }
}

export async function removeCompanyAliasAction(input: { companyId: string; aliasId: string }): Promise<Result> {
  await requireTenantContext();
  if (!input?.aliasId) return { ok: false, error: "Missing alias." };
  try {
    await removeCompanyAlias(input.aliasId);
    revalidatePath(`/companies/${input.companyId}`);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Remove alias failed." };
  }
}

export async function addCompanyTagAction(input: { companyId: string; tag: string }): Promise<Result> {
  const ctx = await requireTenantContext();
  if (!input?.companyId || !input.tag?.trim()) return { ok: false, error: "Missing tag." };
  try {
    await addCompanyTag(ctx.tenantId, input.companyId, input.tag);
    revalidatePath(`/companies/${input.companyId}`);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Add tag failed." };
  }
}

export async function removeCompanyTagAction(input: { companyId: string; tag: string }): Promise<Result> {
  await requireTenantContext();
  if (!input?.companyId || !input.tag) return { ok: false, error: "Missing tag." };
  try {
    await removeCompanyTag(input.companyId, input.tag);
    revalidatePath(`/companies/${input.companyId}`);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Remove tag failed." };
  }
}
