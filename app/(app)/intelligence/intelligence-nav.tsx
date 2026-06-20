"use client";

/**
 * In-section navigation for the Intelligence control surface. Link-based tabs
 * across the sub-routes, with the active tab resolved from the pathname.
 * Reuses the shared filter-chip vocabulary so it matches the rest of the app.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Tab {
  readonly href: string;
  readonly label: string;
  /** Exact match only (Overview), else the tab also matches sub-routes. */
  readonly exact?: boolean;
}

const TABS: readonly Tab[] = [
  { href: "/intelligence", label: "Overview", exact: true },
  { href: "/intelligence/prompts", label: "Prompt library" },
  { href: "/intelligence/skills", label: "Custom skills" },
  { href: "/intelligence/manifesto", label: "Manager manifesto" },
  { href: "/intelligence/testing", label: "Testing lab" },
  { href: "/intelligence/audit", label: "History" },
];

export function IntelligenceNav() {
  const pathname = usePathname();

  return (
    <nav
      className="filter-bar"
      aria-label="Intelligence sections"
      style={{ marginBottom: "var(--space-lg)" }}
    >
      {TABS.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`filter-chip${active ? " filter-chip--active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
