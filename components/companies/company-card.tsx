"use client";

/**
 * components/companies/company-card.tsx
 *
 * A single company in the directory: name, relationship, importance, the people
 * linked to it, and its matching domains. Opens the company page.
 */

import Link from "next/link";
import {
  IMPORTANCE_LABELS,
  IMPORTANCE_TONE,
} from "@/modules/people/people.types";
import { COMPANY_RELATIONSHIP_LABELS, type Company } from "@/modules/companies/company.types";

export function CompanyCard({ company }: { company: Company }) {
  return (
    <Link href={`/companies/${company.id}`} className="person-card">
      <div className="person-card__head">
        <span className="person-card__avatar person-card__avatar--company" aria-hidden="true">
          {company.name.slice(0, 2).toUpperCase()}
        </span>
        <div className="person-card__id">
          <p className="person-card__name">{company.name}</p>
          <p className="integration__kind">
            {COMPANY_RELATIONSHIP_LABELS[company.relationshipType]}
            {company.domains.length > 0 ? ` · ${company.domains[0]?.domain}` : ""}
          </p>
        </div>
        <span className={`status status--${IMPORTANCE_TONE[company.importance]}`}>
          {IMPORTANCE_LABELS[company.importance]}
        </span>
      </div>

      {company.tags.length > 0 ? (
        <div className="person-card__tags">
          {company.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <p className="person-card__meta mono">
        {company.relatedPeopleCount} {company.relatedPeopleCount === 1 ? "person" : "people"} ·{" "}
        {company.domains.length} domain{company.domains.length === 1 ? "" : "s"}
      </p>
    </Link>
  );
}
