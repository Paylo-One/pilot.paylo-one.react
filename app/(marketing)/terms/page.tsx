/**
 * app/(marketing)/terms/page.tsx
 *
 * Public Terms and Conditions. Content + version live in lib/legal/
 * terms-content.ts; this route only renders. First draft — pending legal
 * review before launch.
 */

import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import {
  TERMS_SECTIONS,
  TERMS_VERSION,
  TERMS_EFFECTIVE_DATE,
} from "@/lib/legal/terms-content";

export const metadata: Metadata = {
  title: "Terms and Conditions · Paylo.one",
  description: "The terms that govern your use of Paylo.one.",
};

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms and Conditions"
      version={TERMS_VERSION}
      effectiveDate={TERMS_EFFECTIVE_DATE}
      sections={TERMS_SECTIONS}
      crossLink={{ href: "/privacy", label: "Privacy Policy" }}
    />
  );
}
