/**
 * modules/legal/server.ts
 *
 * Legal acceptance: recording and checking which versions of the Terms and
 * Conditions / Privacy Policy a user has accepted.
 *
 *  - Acceptances are recorded with the secret client (service_role): they are
 *    immutable evidence written server-side at account creation, never from
 *    the browser.
 *  - The current document versions live with the documents themselves
 *    (lib/legal/*). Bumping a version there makes getOutstandingLegalDocuments
 *    report the documents that need re-acceptance, so the app can gate on it.
 */

import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { TERMS_VERSION } from "@/lib/legal/terms-content";
import { PRIVACY_VERSION } from "@/lib/legal/privacy-content";

export type LegalDocumentKind = "terms" | "privacy";

export const CURRENT_LEGAL_VERSIONS: Record<LegalDocumentKind, string> = {
  terms: TERMS_VERSION,
  privacy: PRIVACY_VERSION,
};

export interface RecordLegalAcceptanceInput {
  readonly userId: string;
  readonly documents: readonly LegalDocumentKind[];
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

/**
 * Append acceptance rows for the given documents at their current versions.
 * Throws on failure — callers must not treat a silent miss as accepted.
 */
export async function recordLegalAcceptances(
  input: RecordLegalAcceptanceInput,
): Promise<void> {
  const secret = createSupabaseSecretClient();
  const rows = input.documents.map((document) => ({
    user_id: input.userId,
    document,
    version: CURRENT_LEGAL_VERSIONS[document],
    ip_address: input.ipAddress,
    user_agent: input.userAgent,
  }));
  const { error } = await secret.from("legal_acceptances").insert(rows);
  if (error) {
    throw new Error(`legal_acceptance_failed: ${error.message}`);
  }
}

/** Latest accepted version per document for a user (absent = never accepted). */
export async function getLatestAcceptedVersions(
  userId: string,
): Promise<Partial<Record<LegalDocumentKind, string>>> {
  const secret = createSupabaseSecretClient();
  const { data, error } = await secret
    .from("legal_acceptances")
    .select("document, version, accepted_at")
    .eq("user_id", userId)
    .order("accepted_at", { ascending: false });
  if (error) {
    throw new Error(`legal_acceptance_lookup_failed: ${error.message}`);
  }
  const latest: Partial<Record<LegalDocumentKind, string>> = {};
  for (const row of data ?? []) {
    const doc = row.document as LegalDocumentKind;
    if (!(doc in latest)) latest[doc] = row.version as string;
  }
  return latest;
}

/**
 * Documents the user has not accepted at their *current* version. Empty array
 * means the user is fully covered; non-empty means the app should require
 * (re-)acceptance before continuing.
 */
export async function getOutstandingLegalDocuments(
  userId: string,
): Promise<LegalDocumentKind[]> {
  const latest = await getLatestAcceptedVersions(userId);
  return (Object.keys(CURRENT_LEGAL_VERSIONS) as LegalDocumentKind[]).filter(
    (doc) => latest[doc] !== CURRENT_LEGAL_VERSIONS[doc],
  );
}
