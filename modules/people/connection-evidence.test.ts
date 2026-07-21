import { describe, expect, it } from "vitest";
import {
  collectPairEvidence,
  dedupeItems,
  pairKey,
  type EvidenceItem,
} from "./connection-evidence";
import { scoreConnection } from "./connection-scoring";
import type { Person } from "./people.types";

function person(overrides: Partial<Person> & { id: string; displayName: string }): Person {
  return {
    roleTitle: null,
    organisation: null,
    companyId: null,
    companyName: null,
    relationshipType: "peer",
    importance: "normal",
    status: "active",
    isSelf: false,
    emails: [],
    phones: [],
    tags: [],
    notes: null,
    identities: [],
    relationships: [],
    signals: [],
    linkedActions: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function item(overrides: Partial<EvidenceItem> & { id: string }): EvidenceItem {
  return {
    system: "teams",
    title: null,
    body: null,
    author: null,
    occurredAt: "2026-07-20T10:00:00Z",
    ...overrides,
  };
}

const GARREN = person({ id: "aa", displayName: "Garren Davidse" });
const JOBRIE = person({ id: "bb", displayName: "Jobrie du Preez" });
const SELF = person({ id: "cc", displayName: "Bernard Willer", isSelf: true });

describe("dedupeItems", () => {
  it("collapses exact content duplicates, keeping the most recent", () => {
    const items = [
      item({ id: "1", title: "same", body: "text", occurredAt: "2026-07-01T00:00:00Z" }),
      item({ id: "2", title: "same", body: "text", occurredAt: "2026-07-10T00:00:00Z" }),
      item({ id: "3", title: "different", body: "text" }),
    ];
    const deduped = dedupeItems(items);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((i) => i.title === "same")?.id).toBe("2");
  });
});

describe("collectPairEvidence", () => {
  it("counts duplicate ingested messages once", () => {
    const message = {
      title: "Garren Davidse, Jobrie du Preez: deploy klaar",
      body: "Garren Davidse: deploy klaar",
      author: "Garren Davidse",
    };
    const items = Array.from({ length: 20 }, (_, i) => item({ id: `i${i}`, ...message }));
    const pairs = collectPairEvidence({ people: [GARREN, JOBRIE], items });
    expect(pairs).toHaveLength(1);
    const direct = pairs[0]?.evidence.signals.find((s) => s.kind === "direct_interaction");
    expect(direct?.count).toBe(1);
  });

  it("classifies author→mention as direct interaction and third-party mentions as co-occurrence", () => {
    const items = [
      item({
        id: "1",
        author: "Garren Davidse",
        title: "Garren Davidse, Jobrie du Preez: kyk hierna",
        body: "Garren Davidse: kyk hierna",
      }),
      item({
        id: "2",
        author: "Violet Machuki",
        title: "Ops: check with Garren Davidse and Jobrie du Preez",
        body: "please check",
      }),
    ];
    const pairs = collectPairEvidence({ people: [GARREN, JOBRIE], items });
    const signals = pairs[0]?.evidence.signals ?? [];
    expect(signals.find((s) => s.kind === "direct_interaction")?.count).toBe(1);
    expect(signals.find((s) => s.kind === "co_occurrence")?.count).toBe(1);
  });

  it("excludes the operator's own record from pairs", () => {
    const items = [
      item({
        id: "1",
        author: "Bernard Willer",
        title: "Bernard Willer, Garren Davidse: hi",
        body: "Bernard Willer: hi",
      }),
    ];
    const pairs = collectPairEvidence({ people: [GARREN, SELF], items });
    expect(pairs).toHaveLength(0);
  });

  it("never matches single-word or short display names in free text", () => {
    const shorty = person({ id: "dd", displayName: "Em" });
    const items = [
      item({
        id: "1",
        author: "Garren Davidse",
        title: "Garren Davidse, Jobrie du Preez: Just ask Em or Jobrie du Preez to add you",
        body: "Just ask Em or Jobrie du Preez",
      }),
    ];
    const pairs = collectPairEvidence({ people: [GARREN, JOBRIE, shorty], items });
    const keys = pairs.map((p) => pairKey(p.personAId, p.personBId));
    expect(keys).toContain(pairKey("aa", "bb"));
    expect(keys.some((k) => k.includes("dd"))).toBe(false);
  });

  it("emits shared-company evidence even with no observed items", () => {
    const a = person({ id: "aa", displayName: "Randy Coburn", companyId: "c1", companyName: "Paytec" });
    const b = person({ id: "bb", displayName: "Istvan Jordaan", companyId: "c1", companyName: "Paytec" });
    const pairs = collectPairEvidence({ people: [a, b], items: [] });
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.evidence.signals[0]?.kind).toBe("shared_company");
    expect(pairs[0]?.evidence.signals[0]?.detail).toContain("Paytec");
  });

  it("skips megadocuments mentioning many people (generic content guard)", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      person({ id: `p${i}`, displayName: `Person Number${i}` }),
    );
    const roster = item({
      id: "1",
      title: "All hands",
      body: many.map((p) => p.displayName).join(", "),
      author: "Someone Else",
    });
    const pairs = collectPairEvidence({ people: many, items: [roster] });
    expect(pairs).toHaveLength(0);
  });

  it("attaches profile similarity as a supporting signal", () => {
    const sims = new Map([[pairKey("aa", "bb"), 0.93]]);
    const pairs = collectPairEvidence({
      people: [GARREN, JOBRIE],
      items: [],
      profileSimilarity: sims,
    });
    expect(pairs[0]?.evidence.signals.find((s) => s.kind === "semantic_profile")?.similarity).toBe(0.93);
  });

  it("matches people by email address in item text", () => {
    const a = person({ id: "aa", displayName: "Garren Davidse", emails: ["garren@paytec.io"] });
    const items = [
      item({
        id: "1",
        author: "Jobrie du Preez",
        system: "ms365_mail",
        title: "Re: access",
        body: "Looping in garren@paytec.io on this thread",
      }),
      item({
        id: "2",
        author: "Jobrie du Preez",
        system: "ms365_mail",
        title: "Re: access again",
        body: "garren@paytec.io please confirm",
      }),
    ];
    const pairs = collectPairEvidence({ people: [a, JOBRIE], items });
    const direct = pairs[0]?.evidence.signals.find((s) => s.kind === "direct_interaction");
    expect(direct?.count).toBe(2);
  });

  it("produces evidence that scores end-to-end: real collaborators rank above name-drops", () => {
    const now = new Date("2026-07-21T12:00:00Z");
    const collaboration = Array.from({ length: 14 }, (_, i) =>
      item({
        id: `c${i}`,
        author: i % 2 === 0 ? "Garren Davidse" : "Jobrie du Preez",
        title: `Garren Davidse, Jobrie du Preez: message ${i}`,
        body: `work update ${i}`,
        occurredAt: `2026-07-${String(1 + i).padStart(2, "0")}T09:00:00Z`,
      }),
    );
    const nameDrop = [
      item({
        id: "n1",
        author: "Violet Machuki",
        title: "Minutes: Randy Coburn and Istvan Jordaan were mentioned",
        body: "meeting notes",
      }),
      item({
        id: "n2",
        author: "Violet Machuki",
        title: "Follow-up: Randy Coburn and Istvan Jordaan flagged",
        body: "more notes",
      }),
    ];
    const randy = person({ id: "ee", displayName: "Randy Coburn" });
    const istvan = person({ id: "ff", displayName: "Istvan Jordaan" });
    const pairs = collectPairEvidence({
      people: [GARREN, JOBRIE, randy, istvan],
      items: [...collaboration, ...nameDrop],
    });
    const byPair = new Map(pairs.map((p) => [pairKey(p.personAId, p.personBId), p]));
    const collab = scoreConnection(byPair.get(pairKey("aa", "bb"))!.evidence, now);
    const drop = scoreConnection(byPair.get(pairKey("ee", "ff"))!.evidence, now);
    expect(collab.score).toBeGreaterThan(drop.score);
    expect(collab.tier).toBe("relevant");
    expect(drop.tier === "possible" || drop.tier === "hidden").toBe(true);
  });
});
