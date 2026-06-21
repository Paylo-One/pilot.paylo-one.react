/**
 * modules/people/people-service.ts
 *
 * Typed mock data + pure helpers for the People surface. No persistence and no
 * server-only: this is the scaffold's single source of truth for the People
 * capability, importable by server and client components.
 *
 * Governance: architecture/people-context-architecture.md, services/people-context-service.md.
 *
 * Scaffold note: illustrative people only — not tenant data, not persisted.
 */

import type {
  Person,
  PersonLinkSuggestion,
  PersonSourceMapping,
} from "./people.types";

export const MOCK_PEOPLE: readonly Person[] = [
  {
    id: "person_jacques",
    displayName: "Jacques Becker",
    roleTitle: "Head of Platform",
    organisation: "Paytec Global",
    companyId: null,
    companyName: "Paytec Global",
    isSelf: false,
    relationshipType: "report",
    importance: "high",
    status: "active",
    emails: ["jacques@company.com", "jacques.becker@paytec.global"],
    phones: ["+27 82 555 0102"],
    tags: ["DevOps", "Platform", "Migration"],
    notes: "Owns the payments migration. Prefers concise async updates.",
    identities: [
      { id: "id_j1", personId: "person_jacques", sourceType: "generic", identityType: "email", identityValue: "jacques@company.com", confidence: 1, verifiedByUser: true },
      { id: "id_j2", personId: "person_jacques", sourceType: "github", identityType: "github", identityValue: "jbecker", providerUserId: "8841221", confidence: 0.92, verifiedByUser: true },
      { id: "id_j3", personId: "person_jacques", sourceType: "teams", identityType: "teams", identityValue: "Jacques Becker", confidence: 0.74, verifiedByUser: false },
      { id: "id_j4", personId: "person_jacques", sourceType: "whatsapp", identityType: "whatsapp", identityValue: "+27 82 555 0102", providerUserId: "27825550102@c.us", confidence: 0.81, verifiedByUser: false },
    ],
    relationships: [
      { id: "rel_j1", personId: "person_jacques", relatedType: "project", relatedId: "proj_migration", relatedLabel: "Payments migration", kind: "owner" },
      { id: "rel_j2", personId: "person_jacques", relatedType: "topic", relatedId: "topic_devops", relatedLabel: "DevOps", kind: "member" },
    ],
    signals: [
      { id: "sig_j1", system: "github", title: "PR #482 · failover for payments rail", occurredAt: "2026-06-09T05:40:00.000Z", confidence: 0.9 },
      { id: "sig_j2", system: "email", title: "Re: dual-provider architecture", occurredAt: "2026-06-08T16:20:00.000Z", confidence: 0.86 },
      { id: "sig_j3", system: "whatsapp", title: "Quick note on the migration window", occurredAt: "2026-06-08T19:05:00.000Z", confidence: 0.7 },
    ],
    linkedActions: [
      { id: "act_j1", title: "Approve dual-provider payments architecture", status: "suggested" },
    ],
    createdAt: "2026-05-01T09:00:00.000Z",
    updatedAt: "2026-06-09T06:00:00.000Z",
  },
  {
    id: "person_randy",
    displayName: "Randy Coburn",
    roleTitle: "CTO",
    organisation: "Paytec Global",
    companyId: null,
    companyName: "Paytec Global",
    isSelf: false,
    relationshipType: "peer",
    importance: "critical",
    status: "active",
    emails: ["randy@paytec.global"],
    phones: [],
    tags: ["Leadership", "Architecture"],
    notes: null,
    identities: [
      { id: "id_r1", personId: "person_randy", sourceType: "generic", identityType: "email", identityValue: "randy@paytec.global", confidence: 1, verifiedByUser: true },
      { id: "id_r2", personId: "person_randy", sourceType: "github", identityType: "github", identityValue: "rcoburn", confidence: 0.95, verifiedByUser: true },
    ],
    relationships: [
      { id: "rel_r1", personId: "person_randy", relatedType: "topic", relatedId: "topic_arch", relatedLabel: "Architecture", kind: "lead" },
    ],
    signals: [
      { id: "sig_r1", system: "teams", title: "Thread: payout latency concerns", occurredAt: "2026-06-08T14:10:00.000Z", confidence: 0.72 },
    ],
    linkedActions: [],
    createdAt: "2026-05-01T09:00:00.000Z",
    updatedAt: "2026-06-08T14:10:00.000Z",
  },
  {
    id: "person_priya",
    displayName: "Priya Nair",
    roleTitle: "Head of People",
    organisation: "Paytec Global",
    companyId: null,
    companyName: "Paytec Global",
    isSelf: false,
    relationshipType: "report",
    importance: "normal",
    status: "active",
    emails: ["priya@paytec.global"],
    phones: [],
    tags: ["People", "Compliance"],
    notes: "Driving the SOC 2 evidence collection.",
    identities: [
      { id: "id_p1", personId: "person_priya", sourceType: "generic", identityType: "email", identityValue: "priya@paytec.global", confidence: 1, verifiedByUser: true },
    ],
    relationships: [],
    signals: [
      { id: "sig_p1", system: "email", title: "SOC 2 evidence request (overdue)", occurredAt: "2026-06-07T11:00:00.000Z", confidence: 0.84 },
    ],
    linkedActions: [
      { id: "act_p1", title: "Close out SOC 2 evidence request", status: "deferred" },
    ],
    createdAt: "2026-05-01T09:00:00.000Z",
    updatedAt: "2026-06-07T11:00:00.000Z",
  },
];

/** Lookup a mock person by id. */
export function getPerson(id: string): Person | undefined {
  return MOCK_PEOPLE.find((p) => p.id === id);
}

/** Group a person's identities by source for the identity list UI. */
export function sourceMappings(person: Person): PersonSourceMapping[] {
  const bySource = new Map<string, PersonSourceMapping>();
  for (const identity of person.identities) {
    const key = identity.sourceType;
    const existing = bySource.get(key);
    if (existing) {
      (existing.identities as typeof person.identities).push(identity);
    } else {
      bySource.set(key, { sourceType: identity.sourceType, identities: [identity] });
    }
  }
  return [...bySource.values()];
}

/**
 * Unresolved link suggestions — incoming signals the system could not confidently
 * attribute. Surfaced for explicit user confirmation ("Is this the same person?").
 */
export const MOCK_LINK_SUGGESTIONS: readonly PersonLinkSuggestion[] = [
  {
    id: "sug_1",
    signalPreview: "WhatsApp: “Can we move the migration window to Friday?”",
    sourceSystem: "whatsapp",
    observedIdentity: "+27 82 555 0102",
    candidatePersonId: "person_jacques",
    candidateName: "Jacques Becker",
    confidence: 0.81,
    reason: "Phone number matches a known WhatsApp identity (unverified).",
  },
  {
    id: "sug_2",
    signalPreview: "Email from j.becker@gmail.com about the migration",
    sourceSystem: "email",
    observedIdentity: "j.becker@gmail.com",
    candidatePersonId: "person_jacques",
    candidateName: "Jacques Becker",
    confidence: 0.46,
    reason: "Name similarity only — different domain. Needs confirmation.",
  },
  {
    id: "sug_3",
    signalPreview: "GitHub PR from contractor-mike",
    sourceSystem: "github",
    observedIdentity: "contractor-mike",
    candidatePersonId: null,
    candidateName: null,
    confidence: 0.2,
    reason: "No known person matches this identity. Add as a new person?",
  },
];
