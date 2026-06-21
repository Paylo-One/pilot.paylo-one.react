"use client";

/**
 * components/people/people-surface.tsx
 *
 * The People & Companies overview — the relationship layer at a glance. One calm
 * directory with two views (people and companies), a "Needs review" queue for
 * guided refinement, search, importance filters, and quick capture. Rows open a
 * first-class detail page. Reduce noise, understand connections — not a place to
 * hoard contacts.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IMPORTANCE_LABELS,
  type Person,
  type PersonImportanceLevel,
  type PersonLinkSuggestion,
  type ResolvedRelationship,
} from "@/modules/people/people.types";
import type { Company } from "@/modules/companies/company.types";
import type { DuplicateSuggestion } from "@/modules/people/correlation";
import { PersonCard } from "@/components/people/person-card";
import { PersonForm } from "@/components/people/person-form";
import { CompanyCard } from "@/components/companies/company-card";
import { CompanyForm } from "@/components/companies/company-form";
import { CorrelationInbox } from "@/components/people/correlation-inbox";

type Segment = "people" | "companies";
type Capture = "none" | "person" | "company";

const IMPORTANCE_ORDER: PersonImportanceLevel[] = ["critical", "high", "normal", "low"];

export function PeopleSurface({
  people,
  companies,
  identitySuggestions,
  suggestedLinks,
  duplicates,
}: {
  people: readonly Person[];
  companies: readonly Company[];
  identitySuggestions: readonly PersonLinkSuggestion[];
  suggestedLinks: readonly ResolvedRelationship[];
  duplicates: readonly DuplicateSuggestion[];
}) {
  const router = useRouter();
  const [segment, setSegment] = useState<Segment>("people");
  const [query, setQuery] = useState("");
  const [importance, setImportance] = useState<PersonImportanceLevel | "all">("all");
  const [capture, setCapture] = useState<Capture>("none");

  const filteredPeople = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => {
      if (importance !== "all" && p.importance !== importance) return false;
      if (!q) return true;
      const hay = `${p.displayName} ${p.roleTitle ?? ""} ${p.organisation ?? ""} ${p.companyName ?? ""} ${p.tags.join(" ")} ${p.emails.join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [people, query, importance]);

  const filteredCompanies = useMemo(() => {
    const q = query.trim().toLowerCase();
    return companies.filter((c) => {
      if (importance !== "all" && c.importance !== importance) return false;
      if (!q) return true;
      const hay = `${c.name} ${c.aliases.map((a) => a.alias).join(" ")} ${c.domains.map((d) => d.domain).join(" ")} ${c.tags.join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [companies, query, importance]);

  return (
    <div className="people">
      <CorrelationInbox
        identitySuggestions={identitySuggestions}
        suggestedLinks={suggestedLinks}
        duplicates={duplicates}
      />

      <div className="people-toolbar">
        <div className="segmented" role="tablist" aria-label="View">
          <button
            type="button"
            role="tab"
            aria-selected={segment === "people"}
            className={`segmented__option${segment === "people" ? " segmented__option--active" : ""}`}
            onClick={() => setSegment("people")}
          >
            People <span className="mono">{people.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={segment === "companies"}
            className={`segmented__option${segment === "companies" ? " segmented__option--active" : ""}`}
            onClick={() => setSegment("companies")}
          >
            Companies <span className="mono">{companies.length}</span>
          </button>
        </div>

        <div className="people-toolbar__search">
          <input
            type="search"
            className="input"
            placeholder={segment === "people" ? "Search people, roles, tags, email" : "Search companies, domains, aliases"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search"
          />
        </div>

        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() =>
            setCapture((c) => (c === segment.slice(0, -1) ? "none" : (segment === "people" ? "person" : "company")))
          }
        >
          {segment === "people" ? "Add person" : "Add company"}
        </button>
      </div>

      <div className="filter-bar people-filter">
        <button
          type="button"
          className={`filter-chip${importance === "all" ? " filter-chip--active" : ""}`}
          onClick={() => setImportance("all")}
        >
          All
        </button>
        {IMPORTANCE_ORDER.map((level) => (
          <button
            key={level}
            type="button"
            className={`filter-chip filter-chip--status${importance === level ? " filter-chip--active" : ""}`}
            onClick={() => setImportance(level)}
          >
            {IMPORTANCE_LABELS[level]}
          </button>
        ))}
      </div>

      {capture === "person" ? (
        <div className="mb-lg">
          <PersonForm
            onCreated={() => {
              setCapture("none");
              router.refresh();
            }}
          />
        </div>
      ) : null}
      {capture === "company" ? (
        <div className="mb-lg">
          <CompanyForm
            onCreated={() => {
              setCapture("none");
              router.refresh();
            }}
          />
        </div>
      ) : null}

      {segment === "people" ? (
        people.length === 0 ? (
          <EmptyState
            title="Establish your directory"
            body="Add the people who matter to your work. As sources sync, Pilot links their activity here, so your briefing knows who is behind what."
          />
        ) : filteredPeople.length === 0 ? (
          <EmptyState title="No people match" body="Try a different search or filter." dashed />
        ) : (
          <div className="people-grid">
            {filteredPeople.map((person) => (
              <PersonCard
                key={person.id}
                person={person}
                selected={false}
                onSelect={() => router.push(`/people/${person.id}`)}
              />
            ))}
          </div>
        )
      ) : companies.length === 0 ? (
        <EmptyState
          title="No companies yet"
          body="Add the organisations behind your people: clients, suppliers, partners, investors. Give a company a domain and Pilot can link the people who email from it."
        />
      ) : filteredCompanies.length === 0 ? (
        <EmptyState title="No companies match" body="Try a different search or filter." dashed />
      ) : (
        <div className="people-grid">
          {filteredCompanies.map((company) => (
            <CompanyCard key={company.id} company={company} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ title, body, dashed }: { title: string; body: string; dashed?: boolean }) {
  return (
    <div className={`people-empty${dashed ? " people-empty--dashed" : ""}`}>
      <p className="people-empty__title">{title}</p>
      <p className="people-empty__body">{body}</p>
    </div>
  );
}
