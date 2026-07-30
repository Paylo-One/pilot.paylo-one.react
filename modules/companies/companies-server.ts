import "server-only";

/**
 * modules/companies/companies-server.ts
 *
 * Server-only data layer for Company Context. Reads/writes use the RLS USER
 * client so tenant isolation is enforced by policy; inserts set `tenant_id`
 * explicitly (WITH CHECK validates it).
 *
 * Persists `companies` + `company_aliases` + `company_domains` + `company_tags`,
 * and proposes person↔company `works_at` edges (entity_links suggestions) by
 * matching a person's verified email identity to a company domain. The system
 * proposes; the operator confirms — links are never silently applied.
 *
 * Governance: services/company-context-service.md, architecture/people-context-architecture.md.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { upsertEntityLink, listRelationshipsFor } from "@/modules/people/relationships";
import type {
  Company,
  CompanyActivity,
  CompanyDetail,
  CompanyPerson,
  CompanyRelationshipType,
} from "./company.types";
import type { PersonImportanceLevel, PersonStatus } from "@/modules/people/people.types";

// --- Row shapes -------------------------------------------------------------

interface CompanyRow {
  id: string;
  name: string;
  relationship_type: string;
  importance_level: string;
  status: string;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}
const COMPANY_COLS =
  "id, name, relationship_type, importance_level, status, notes, archived_at, created_at, updated_at";

function mapCompany(
  row: CompanyRow,
  aliases: Company["aliases"],
  domains: Company["domains"],
  tags: string[],
  relatedPeopleCount: number,
): Company {
  return {
    id: row.id,
    name: row.name,
    relationshipType: row.relationship_type as CompanyRelationshipType,
    importance: row.importance_level as PersonImportanceLevel,
    status: row.status as PersonStatus,
    notes: row.notes,
    aliases,
    domains,
    tags,
    relatedPeopleCount,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ListCompaniesOptions {
  /** Include archived (soft-deleted) records. Default: active only. */
  readonly includeArchived?: boolean;
}

// --- Reads ------------------------------------------------------------------

/** The tenant's companies with aliases, domains, tags, and linked-people counts. */
export async function listCompanies(options: ListCompaniesOptions = {}): Promise<Company[]> {
  const supabase = await createSupabaseServerClient();
  let companyQuery = supabase
    .from("companies")
    .select(COMPANY_COLS)
    .order("name", { ascending: true });
  if (!options.includeArchived) companyQuery = companyQuery.is("archived_at", null);
  const { data: companyData, error } = await companyQuery;
  if (error) throw new Error(error.message);
  const rows = (companyData ?? []) as CompanyRow[];
  if (rows.length === 0) return [];

  const [
    { data: aliasData },
    { data: domainData },
    { data: tagData },
    { data: peopleData },
  ] = await Promise.all([
    supabase.from("company_aliases").select("id, company_id, alias, source"),
    supabase.from("company_domains").select("id, company_id, domain"),
    supabase.from("company_tags").select("company_id, tag"),
    supabase.from("people").select("company_id"),
  ]);

  const aliasesByCompany = new Map<string, Company["aliases"]>();
  for (const a of (aliasData ?? []) as { id: string; company_id: string; alias: string; source: string | null }[]) {
    const list = aliasesByCompany.get(a.company_id) ?? [];
    list.push({ id: a.id, alias: a.alias, source: a.source });
    aliasesByCompany.set(a.company_id, list);
  }
  const domainsByCompany = new Map<string, Company["domains"]>();
  for (const d of (domainData ?? []) as { id: string; company_id: string; domain: string }[]) {
    const list = domainsByCompany.get(d.company_id) ?? [];
    list.push({ id: d.id, domain: d.domain });
    domainsByCompany.set(d.company_id, list);
  }
  const tagsByCompany = new Map<string, string[]>();
  for (const t of (tagData ?? []) as { company_id: string; tag: string }[]) {
    const list = tagsByCompany.get(t.company_id) ?? [];
    list.push(t.tag);
    tagsByCompany.set(t.company_id, list);
  }
  const peopleCount = new Map<string, number>();
  for (const p of (peopleData ?? []) as { company_id: string | null }[]) {
    if (p.company_id) peopleCount.set(p.company_id, (peopleCount.get(p.company_id) ?? 0) + 1);
  }

  return rows.map((row) =>
    mapCompany(
      row,
      aliasesByCompany.get(row.id) ?? [],
      domainsByCompany.get(row.id) ?? [],
      tagsByCompany.get(row.id) ?? [],
      peopleCount.get(row.id) ?? 0,
    ),
  );
}

const EMAIL_DOMAIN_RE = /@([^\s>]+)/;

/** Extract a lowercased domain from an author string ("Name <a@acme.com>"). */
function domainOf(author: string | null): string | null {
  if (!author) return null;
  const m = EMAIL_DOMAIN_RE.exec(author);
  return m && m[1] ? m[1].trim().toLowerCase().replace(/>$/, "") : null;
}

/** Full company detail: people, relationships, and recent domain-matched activity. */
export async function getCompanyDetail(companyId: string): Promise<CompanyDetail | null> {
  // Include archived so an archived company's page still opens (for restore).
  const companies = await listCompanies({ includeArchived: true });
  const company = companies.find((c) => c.id === companyId);
  if (!company) return null;

  const supabase = await createSupabaseServerClient();
  const [{ data: peopleData }, relationships] = await Promise.all([
    supabase
      .from("people")
      .select("id, display_name, role_title")
      .eq("company_id", companyId)
      .order("display_name", { ascending: true }),
    listRelationshipsFor("company", companyId, { includeSuggested: true }),
  ]);

  const relatedPeople: CompanyPerson[] = (
    (peopleData ?? []) as { id: string; display_name: string; role_title: string | null }[]
  ).map((p) => ({ id: p.id, displayName: p.display_name, roleTitle: p.role_title }));

  // Recent activity = recent source items whose author domain matches a company domain.
  let recentActivity: CompanyActivity[] = [];
  const domains = new Set(company.domains.map((d) => d.domain.toLowerCase()));
  if (domains.size > 0) {
    const { data: itemData } = await supabase
      .from("source_items")
      .select("id, system, title, author, occurred_at, created_at")
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(200);
    recentActivity = (
      (itemData ?? []) as {
        id: string;
        system: string;
        title: string | null;
        author: string | null;
        occurred_at: string | null;
        created_at: string;
      }[]
    )
      .filter((it) => {
        const d = domainOf(it.author);
        return d !== null && domains.has(d);
      })
      .slice(0, 10)
      .map((it) => ({
        id: it.id,
        system: it.system,
        title: it.title?.trim() || "(no preview)",
        occurredAt: it.occurred_at ?? it.created_at,
      }));
  }

  return { ...company, relatedPeople, relationships, recentActivity };
}

// --- Writes -----------------------------------------------------------------

export interface CreateCompanyInput {
  name: string;
  relationshipType?: CompanyRelationshipType;
  importance?: PersonImportanceLevel;
  notes?: string | null;
  domains?: string[];
  aliases?: string[];
  tags?: string[];
}

export async function createCompany(
  tenantId: string,
  input: CreateCompanyInput,
): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("companies")
    .insert({
      tenant_id: tenantId,
      name: input.name.trim(),
      relationship_type: input.relationshipType ?? "other",
      importance_level: input.importance ?? "normal",
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "company_create_failed");
  const companyId = data.id as string;

  const domainRows = (input.domains ?? [])
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
    .map((domain) => ({ tenant_id: tenantId, company_id: companyId, domain }));
  if (domainRows.length > 0) {
    const { error: dErr } = await supabase.from("company_domains").insert(domainRows);
    if (dErr) throw new Error(dErr.message);
  }
  const aliasRows = (input.aliases ?? [])
    .map((a) => a.trim())
    .filter(Boolean)
    .map((alias) => ({ tenant_id: tenantId, company_id: companyId, alias }));
  if (aliasRows.length > 0) {
    const { error: aErr } = await supabase.from("company_aliases").insert(aliasRows);
    if (aErr) throw new Error(aErr.message);
  }
  const tagRows = (input.tags ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .map((tag) => ({ tenant_id: tenantId, company_id: companyId, tag }));
  if (tagRows.length > 0) {
    const { error: tErr } = await supabase.from("company_tags").insert(tagRows);
    if (tErr) throw new Error(tErr.message);
  }
  return companyId;
}

export interface UpdateCompanyPatch {
  name?: string;
  relationshipType?: CompanyRelationshipType;
  importance?: PersonImportanceLevel;
  status?: PersonStatus;
  notes?: string | null;
}

export async function updateCompany(companyId: string, patch: UpdateCompanyPatch): Promise<boolean> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.relationshipType !== undefined) update.relationship_type = patch.relationshipType;
  if (patch.importance !== undefined) update.importance_level = patch.importance;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (Object.keys(update).length === 0) return false;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("companies")
    .update(update)
    .eq("id", companyId)
    .select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

/**
 * Archive or restore a company (soft delete). Archived companies leave the
 * directory and the connections graph but keep domains, aliases, tags, and
 * edges so a restore brings everything back. Returns false when the company is
 * not visible to the caller (RLS) or does not exist.
 */
export async function setCompanyArchived(companyId: string, archived: boolean): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("companies")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", companyId)
    .select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

export async function deleteCompany(companyId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("companies").delete().eq("id", companyId);
  if (error) throw new Error(error.message);
}

export async function addCompanyDomain(tenantId: string, companyId: string, domain: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("company_domains").insert({
    tenant_id: tenantId,
    company_id: companyId,
    domain: domain.trim().toLowerCase(),
  });
  if (error) throw new Error(error.message);
}

export async function removeCompanyDomain(domainId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("company_domains").delete().eq("id", domainId);
  if (error) throw new Error(error.message);
}

export async function addCompanyAlias(tenantId: string, companyId: string, alias: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("company_aliases")
    .upsert(
      { tenant_id: tenantId, company_id: companyId, alias: alias.trim() },
      { onConflict: "company_id,alias", ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);
}

export async function removeCompanyAlias(aliasId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("company_aliases").delete().eq("id", aliasId);
  if (error) throw new Error(error.message);
}

export async function addCompanyTag(tenantId: string, companyId: string, tag: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("company_tags")
    .upsert(
      { tenant_id: tenantId, company_id: companyId, tag: tag.trim() },
      { onConflict: "company_id,tag", ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);
}

export async function removeCompanyTag(companyId: string, tag: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("company_tags")
    .delete()
    .eq("company_id", companyId)
    .eq("tag", tag);
  if (error) throw new Error(error.message);
}

// --- Correlation: propose person↔company links ------------------------------

/**
 * Propose `works_at` edges (as suggestions) by matching a person's verified email
 * identity to a company domain. Skips people already linked to that company. Each
 * suggestion carries a plain-language evidence summary. Returns how many were
 * added/refreshed. The operator confirms each from the correlation inbox.
 */
export async function generateCompanyLinkSuggestions(tenantId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const [{ data: domainData }, { data: identityData }, { data: peopleData }] =
    await Promise.all([
      supabase.from("company_domains").select("company_id, domain"),
      supabase.from("person_identities").select("person_id, identity_value").eq("identity_type", "email"),
      supabase.from("people").select("id, display_name, company_id"),
    ]);

  const domains = (domainData ?? []) as { company_id: string; domain: string }[];
  if (domains.length === 0) return 0;
  const domainToCompany = new Map<string, string>();
  for (const d of domains) domainToCompany.set(d.domain.toLowerCase(), d.company_id);

  const peopleById = new Map<string, { name: string; companyId: string | null }>();
  for (const p of (peopleData ?? []) as { id: string; display_name: string; company_id: string | null }[]) {
    peopleById.set(p.id, { name: p.display_name, companyId: p.company_id });
  }

  let added = 0;
  for (const id of (identityData ?? []) as { person_id: string; identity_value: string }[]) {
    const at = id.identity_value.lastIndexOf("@");
    if (at < 0) continue;
    const domain = id.identity_value.slice(at + 1).trim().toLowerCase();
    const companyId = domainToCompany.get(domain);
    if (!companyId) continue;
    const person = peopleById.get(id.person_id);
    if (!person || person.companyId === companyId) continue; // already linked

    await upsertEntityLink(tenantId, {
      sourceType: "person",
      sourceId: id.person_id,
      targetType: "company",
      targetId: companyId,
      relationshipType: "works_at",
      confidence: 0.8,
      origin: "system",
      status: "suggested",
      evidenceSummary: `${person.name} uses an email on ${domain}, which belongs to this company.`,
    });
    added += 1;
  }
  return added;
}
