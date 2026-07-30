/**
 * modules/companies/company.types.ts
 *
 * Companies — a first-class entity, distinct from people but linkable to them.
 * A company is the organisation behind the activity: a client, supplier, partner,
 * investor, or your own. Companies carry aliases and domains (the matching
 * anchors), the same behavioural tag taxonomy as people, and graph edges to the
 * people, topics, and work they relate to.
 *
 * Pure types + label maps (no persistence, no server-only) so server and client
 * share them.
 *
 * Governance: docs/services/company-context-service.md,
 * docs/product/people-and-companies.md.
 */

import type {
  PersonImportanceLevel,
  PersonStatus,
  ResolvedRelationship,
} from "@/modules/people/people.types";

/** A company's relationship to the operator. */
export type CompanyRelationshipType =
  | "client"
  | "supplier"
  | "partner"
  | "investor"
  | "competitor"
  | "prospect"
  | "vendor"
  | "internal"
  | "other";

/** A name a company is also known by (feeds dedup + alias handling). */
export interface CompanyAlias {
  readonly id: string;
  readonly alias: string;
  readonly source?: string | null;
}

/** A domain that resolves activity to a company (the matching anchor). */
export interface CompanyDomain {
  readonly id: string;
  readonly domain: string;
}

/** A company record as the directory shows it. */
export interface Company {
  readonly id: string;
  readonly name: string;
  readonly relationshipType: CompanyRelationshipType;
  readonly importance: PersonImportanceLevel;
  readonly status: PersonStatus;
  readonly notes: string | null;
  readonly aliases: CompanyAlias[];
  readonly domains: CompanyDomain[];
  readonly tags: string[];
  /** How many people are linked to this company. */
  readonly relatedPeopleCount: number;
  /** Set when the record is archived (soft-deleted); null while active. */
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A person linked to a company (for the company detail page). */
export interface CompanyPerson {
  readonly id: string;
  readonly displayName: string;
  readonly roleTitle: string | null;
}

/** A recent source item attributed to a company (by domain match). */
export interface CompanyActivity {
  readonly id: string;
  readonly system: string;
  readonly title: string;
  readonly occurredAt: string;
}

/** The full company detail view. */
export interface CompanyDetail extends Company {
  readonly relatedPeople: CompanyPerson[];
  readonly relationships: ResolvedRelationship[];
  readonly recentActivity: CompanyActivity[];
}

export const COMPANY_RELATIONSHIP_LABELS: Record<CompanyRelationshipType, string> = {
  client: "Client",
  supplier: "Supplier",
  partner: "Partner",
  investor: "Investor",
  competitor: "Competitor",
  prospect: "Prospect",
  vendor: "Vendor",
  internal: "Internal",
  other: "Other",
};
