"use client";

/**
 * In-page section navigation for Settings. Renders anchor links to each section
 * group and highlights the one currently in view (a light scrollspy via
 * IntersectionObserver). On desktop it is a sticky left rail; on narrow screens
 * the layout collapses it to a scrollable bar above the content.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export interface SettingsSection {
  readonly id: string;
  readonly label: string;
}

export function SettingsNav({ sections }: { sections: SettingsSection[] }) {
  const t = useTranslations("settings");
  const [active, setActive] = useState<string>(sections[0]?.id ?? "");

  useEffect(() => {
    const elements = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const inView = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          );
        if (inView[0]) setActive(inView[0].target.id);
      },
      // Offset the top for the sticky topbar; only treat the upper band as
      // "active" so the highlight tracks the heading you are reading.
      { rootMargin: "-72px 0px -60% 0px", threshold: 0 },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav className="settings-toc" aria-label={t("sectionsAria")}>
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className={`settings-toc__link${
            active === section.id ? " settings-toc__link--active" : ""
          }`}
          aria-current={active === section.id ? "true" : undefined}
          onClick={() => setActive(section.id)}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}
