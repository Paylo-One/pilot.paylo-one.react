/**
 * components/legal-document.tsx
 *
 * Shared renderer for the public legal documents (Terms, Privacy). Calm,
 * readable single column: brand lockup linking home, document meta (version +
 * effective date), anchored sections, and a footer cross-linking the other
 * document. Content lives in lib/legal/* so the documents and their versions
 * travel together.
 */

import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { PayloWordmark } from "@/components/paylo-wordmark";
import type { LegalSection } from "@/lib/legal/terms-content";

export function LegalDocument({
  title,
  version,
  effectiveDate,
  sections,
  crossLink,
}: {
  title: string;
  version: string;
  effectiveDate: string;
  sections: readonly LegalSection[];
  crossLink: { href: string; label: string };
}) {
  return (
    <main className="legal">
      <Link href="/" className="legal__brand" aria-label="Paylo.one home">
        <BrandMark size={24} />
        <PayloWordmark size={16} />
      </Link>

      <header className="legal__head">
        <p className="eyebrow">Legal</p>
        <h1 className="legal__title">{title}</h1>
        <p className="legal__meta mono">
          Version {version} · Effective {effectiveDate}
        </p>
      </header>

      {/* Section headings carry their own numbering in lib/legal content. */}
      {sections.map((section) => (
        <section key={section.id} id={section.id} className="legal__section">
          <h2 className="legal__heading">{section.heading}</h2>
          {section.paragraphs.map((paragraph, i) => (
            <p key={i} className="legal__para">
              {paragraph}
            </p>
          ))}
          {section.bullets ? (
            <ul className="legal__list">
              {section.bullets.map((bullet, i) => (
                <li key={i}>{bullet}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}

      <footer className="legal__footer">
        <Link href={crossLink.href}>{crossLink.label}</Link>
        <Link href="/">Back to Paylo.one</Link>
      </footer>
    </main>
  );
}
