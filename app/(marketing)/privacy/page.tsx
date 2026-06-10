/**
 * app/(marketing)/privacy/page.tsx
 *
 * Public Privacy Policy. Content + version live in lib/legal/
 * privacy-content.ts; this route only renders. First draft — pending legal
 * review before launch.
 */

import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import {
  PRIVACY_SECTIONS,
  PRIVACY_VERSION,
  PRIVACY_EFFECTIVE_DATE,
} from "@/lib/legal/privacy-content";

export const metadata: Metadata = {
  title: "Privacy Policy · Paylo.one",
  description: "How Paylo.one collects, uses, and protects your information.",
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      version={PRIVACY_VERSION}
      effectiveDate={PRIVACY_EFFECTIVE_DATE}
      sections={PRIVACY_SECTIONS}
      crossLink={{ href: "/terms", label: "Terms and Conditions" }}
    />
  );
}
