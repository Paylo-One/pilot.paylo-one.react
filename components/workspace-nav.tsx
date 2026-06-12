"use client";

/**
 * components/workspace-nav.tsx
 *
 * Primary navigation for the workspace command layer. Client component only so
 * it can resolve the active surface from the pathname; it holds no other state.
 *
 * Wording follows product/screen-map.md and the task's product-language rule:
 * the MCP surface is presented to operators as the "Tenant Tool Layer", with
 * MCP kept as a quiet technical marker.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  tag?: string;
  icon: React.ReactNode;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const ICON_PROPS = {
  className: "nav__icon",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const GROUPS: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      {
        href: "/briefing",
        label: "Briefing",
        icon: (
          <svg {...ICON_PROPS}>
            <path d="M4 5h16M4 10h16M4 15h10M4 20h6" />
          </svg>
        ),
      },
      {
        href: "/actions",
        label: "Actions",
        icon: (
          <svg {...ICON_PROPS}>
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        ),
      },
      {
        href: "/diary",
        label: "Diary",
        icon: (
          <svg {...ICON_PROPS}>
            <path d="M6 3h11a2 2 0 0 1 2 2v16a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
            <path d="M8 3v18" />
          </svg>
        ),
      },
      {
        href: "/people",
        label: "People",
        icon: (
          <svg {...ICON_PROPS}>
            <circle cx="9" cy="8" r="3" />
            <path d="M3 20a6 6 0 0 1 12 0" />
            <path d="M16 6.5a3 3 0 0 1 0 5.5M22 20a6 6 0 0 0-4-5.6" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        href: "/sources",
        label: "Sources",
        icon: (
          <svg {...ICON_PROPS}>
            <path d="M12 2v6M12 16v6" />
            <rect x="8" y="8" width="8" height="8" rx="2" />
            <path d="M2 12h6M16 12h6" />
          </svg>
        ),
      },
      {
        href: "/prompts",
        label: "Prompts",
        icon: (
          <svg {...ICON_PROPS}>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="m7 9 3 3-3 3M12 15h5" />
          </svg>
        ),
      },
      {
        href: "/mcp",
        label: "Tenant Tool Layer",
        tag: "MCP",
        icon: (
          <svg {...ICON_PROPS}>
            <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" />
            <path d="M3 7l9 5 9-5M12 12v10" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Account",
    items: [
      {
        href: "/settings",
        label: "Settings",
        icon: (
          <svg {...ICON_PROPS}>
            <path d="M4 6h16M4 12h16M4 18h16" />
            <circle cx="9" cy="6" r="2" fill="var(--colour-surface-command)" />
            <circle cx="15" cy="12" r="2" fill="var(--colour-surface-command)" />
            <circle cx="8" cy="18" r="2" fill="var(--colour-surface-command)" />
          </svg>
        ),
      },
    ],
  },
];

export function WorkspaceNav({
  onNavigate,
}: {
  /** Called when a nav link is chosen — lets the mobile drawer close itself. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="nav" aria-label="Primary">
      {GROUPS.map((group) => (
        <div key={group.label} className="nav__group">
          <span className="nav__group-label">{group.label}</span>
          {group.items.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav__item${active ? " nav__item--active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.tag ? (
                  <span className="nav__item-tag">{item.tag}</span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
