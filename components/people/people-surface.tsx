"use client";

/**
 * components/people/people-surface.tsx
 *
 * The People & Companies workspace — five tabs, one calm layer:
 *
 *  · People / Companies — the directory: search, importance filters, sorting,
 *    incremental pagination, quick capture with duplicate warnings, and the
 *    "Needs review" correlation queue.
 *  · Suggestions — a curated handful of high-confidence relationship
 *    suggestions (the old exhaustive semantic list lives behind "View more").
 *  · Connections — the relationship network, drawn progressively.
 *  · Archived — archived records, restorable in one click.
 *
 * The active tab lives in the URL (?tab=…) so views are shareable and survive
 * refresh. Rows open first-class detail pages.
 */

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  IMPORTANCE_LABELS,
  type Person,
  type PersonImportanceLevel,
  type PersonLinkSuggestion,
} from "@/modules/people/people.types";
import type { Company } from "@/modules/companies/company.types";
import type { DuplicateSuggestion } from "@/modules/people/correlation";
import type { CuratedSuggestions, PeopleNetwork } from "@/modules/people/relationships";
import { PersonCard } from "@/components/people/person-card";
import { PersonForm } from "@/components/people/person-form";
import { CompanyCard } from "@/components/companies/company-card";
import { CompanyForm } from "@/components/companies/company-form";
import { CorrelationInbox } from "@/components/people/correlation-inbox";
import { SuggestionsPanel } from "@/components/people/suggestions-panel";
import { ConnectionsGraph } from "@/components/people/connections-graph";
import { ArchivedPanel } from "@/components/people/archived-panel";

type Tab = "people" | "companies" | "suggestions" | "connections" | "archived";
type SortOrder = "name" | "importance" | "recent";

const TABS: readonly { id: Tab; label: string }[] = [
  { id: "people", label: "People" },
  { id: "companies", label: "Companies" },
  { id: "suggestions", label: "Suggestions" },
  { id: "connections", label: "Connections" },
  { id: "archived", label: "Archived" },
];

const IMPORTANCE_ORDER: PersonImportanceLevel[] = ["critical", "high", "normal", "low"];
const IMPORTANCE_RANK: Record<PersonImportanceLevel, number> = { critical: 3, high: 2, normal: 1, low: 0 };
const PAGE_SIZE = 24;

export function PeopleSurface({
  people,
  archivedPeople,
  companies,
  archivedCompanies,
  identitySuggestions,
  duplicates,
  suggestions,
  network,
  canManage,
  canDelete,
}: {
  people: readonly Person[];
  archivedPeople: readonly Person[];
  companies: readonly Company[];
  archivedCompanies: readonly Company[];
  identitySuggestions: readonly PersonLinkSuggestion[];
  duplicates: readonly DuplicateSuggestion[];
  suggestions: CuratedSuggestions;
  network: PeopleNetwork;
  canManage: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const tab: Tab = TABS.some((t) => t.id === rawTab) ? (rawTab as Tab) : "people";

  const [query, setQuery] = useState("");
  const [importance, setImportance] = useState<PersonImportanceLevel | "all">("all");
  const [sort, setSort] = useState<SortOrder>("name");
  const [capture, setCapture] = useState<"none" | "person" | "company">("none");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [notice, setNotice] = useState<string | null>(null);

  function setTab(next: Tab) {
    setVisibleCount(PAGE_SIZE);
    setNotice(null);
    router.replace(next === "people" ? pathname : `${pathname}?tab=${next}`, { scroll: false });
  }

  const filteredPeople = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = people.filter((p) => {
      if (importance !== "all" && p.importance !== importance) return false;
      if (!q) return true;
      const hay = `${p.displayName} ${p.roleTitle ?? ""} ${p.organisation ?? ""} ${p.companyName ?? ""} ${p.tags.join(" ")} ${p.emails.join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
    return [...list].sort((a, b) => {
      if (sort === "importance") return IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance] || a.displayName.localeCompare(b.displayName);
      if (sort === "recent") return b.updatedAt.localeCompare(a.updatedAt);
      return a.displayName.localeCompare(b.displayName);
    });
  }, [people, query, importance, sort]);

  const filteredCompanies = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = companies.filter((c) => {
      if (importance !== "all" && c.importance !== importance) return false;
      if (!q) return true;
      const hay = `${c.name} ${c.aliases.map((a) => a.alias).join(" ")} ${c.domains.map((d) => d.domain).join(" ")} ${c.tags.join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
    return [...list].sort((a, b) => {
      if (sort === "importance") return IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance] || a.name.localeCompare(b.name);
      if (sort === "recent") return b.updatedAt.localeCompare(a.updatedAt);
      return a.name.localeCompare(b.name);
    });
  }, [companies, query, importance, sort]);

  const archivedCount = archivedPeople.length + archivedCompanies.length;
  const suggestionsCount = suggestions.totals.people + suggestions.totals.companies;

  const tabCounts: Record<Tab, number | null> = {
    people: people.length,
    companies: companies.length,
    suggestions: suggestionsCount,
    connections: null,
    archived: archivedCount,
  };

  const isDirectory = tab === "people" || tab === "companies";

  return (
    <div className="people">
      <div className="segmented people-tabs" role="tablist" aria-label="People and companies views">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`segmented__option${tab === t.id ? " segmented__option--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {tabCounts[t.id] !== null && tabCounts[t.id]! > 0 ? (
              <span className="mono"> {tabCounts[t.id]}</span>
            ) : null}
          </button>
        ))}
      </div>

      {notice ? (
        <p className="form-message form-message--success" role="status">
          {notice}
        </p>
      ) : null}

      {isDirectory ? (
        <>
          <CorrelationInbox
            identitySuggestions={identitySuggestions}
            duplicates={duplicates}
            canManage={canManage}
          />

          <div className="people-toolbar">
            <div className="people-toolbar__search">
              <input
                type="search"
                className="input"
                placeholder={tab === "people" ? "Search people, roles, tags, email" : "Search companies, domains, aliases"}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setVisibleCount(PAGE_SIZE);
                }}
                aria-label="Search"
              />
            </div>
            <select
              className="input people-toolbar__sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOrder)}
              aria-label="Sort order"
            >
              <option value="name">Sort: Name</option>
              <option value="importance">Sort: Importance</option>
              <option value="recent">Sort: Recently updated</option>
            </select>
            {canManage ? (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() =>
                  setCapture((c) => {
                    const wanted = tab === "people" ? "person" : "company";
                    return c === wanted ? "none" : wanted;
                  })
                }
              >
                {tab === "people" ? "Add person" : "Add company"}
              </button>
            ) : null}
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
                onClick={() => {
                  setImportance(level);
                  setVisibleCount(PAGE_SIZE);
                }}
              >
                {IMPORTANCE_LABELS[level]}
              </button>
            ))}
          </div>

          {capture === "person" && tab === "people" ? (
            <div className="mb-lg">
              <PersonForm
                existingPeople={people.map((p) => ({ id: p.id, displayName: p.displayName, emails: p.emails }))}
                onDone={() => {
                  setCapture("none");
                  setNotice("Person saved.");
                  router.refresh();
                }}
              />
            </div>
          ) : null}
          {capture === "company" && tab === "companies" ? (
            <div className="mb-lg">
              <CompanyForm
                existingCompanies={companies.map((c) => ({
                  id: c.id,
                  name: c.name,
                  aliases: c.aliases.map((a) => a.alias),
                  domains: c.domains.map((d) => d.domain),
                }))}
                onDone={() => {
                  setCapture("none");
                  setNotice("Company saved.");
                  router.refresh();
                }}
              />
            </div>
          ) : null}
        </>
      ) : null}

      {tab === "people" ? (
        people.length === 0 ? (
          <EmptyState
            title="Establish your directory"
            body="Add the people who matter to your work. As sources sync, Pilot links their activity here, so your briefing knows who is behind what."
          />
        ) : filteredPeople.length === 0 ? (
          <EmptyState title="No people match" body="Try a different search or filter." dashed />
        ) : (
          <>
            <div className="people-grid">
              {filteredPeople.slice(0, visibleCount).map((person) => (
                <PersonCard
                  key={person.id}
                  person={person}
                  selected={false}
                  onSelect={() => router.push(`/people/${person.id}`)}
                />
              ))}
            </div>
            <LoadMore
              shown={Math.min(visibleCount, filteredPeople.length)}
              total={filteredPeople.length}
              onMore={() => setVisibleCount((v) => v + PAGE_SIZE)}
            />
          </>
        )
      ) : null}

      {tab === "companies" ? (
        companies.length === 0 ? (
          <EmptyState
            title="No companies yet"
            body="Add the organisations behind your people: clients, suppliers, partners, investors. Give a company a domain and Pilot can link the people who email from it."
          />
        ) : filteredCompanies.length === 0 ? (
          <EmptyState title="No companies match" body="Try a different search or filter." dashed />
        ) : (
          <>
            <div className="people-grid">
              {filteredCompanies.slice(0, visibleCount).map((company) => (
                <CompanyCard key={company.id} company={company} />
              ))}
            </div>
            <LoadMore
              shown={Math.min(visibleCount, filteredCompanies.length)}
              total={filteredCompanies.length}
              onMore={() => setVisibleCount((v) => v + PAGE_SIZE)}
            />
          </>
        )
      ) : null}

      {tab === "suggestions" ? <SuggestionsPanel suggestions={suggestions} canManage={canManage} /> : null}

      {tab === "connections" ? <ConnectionsGraph network={network} canManage={canManage} /> : null}

      {tab === "archived" ? (
        <ArchivedPanel
          people={archivedPeople}
          companies={archivedCompanies}
          canManage={canManage}
          canDelete={canDelete}
        />
      ) : null}
    </div>
  );
}

function LoadMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <div className="people-load-more">
      <span className="repo-row__meta mono">
        Showing {shown} of {total}
      </span>
      <button type="button" className="btn btn--secondary btn--sm" onClick={onMore}>
        Load more
      </button>
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
