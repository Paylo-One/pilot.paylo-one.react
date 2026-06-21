import { describe, expect, it } from "vitest";

import {
  TAG_CATALOGUE,
  getTagDefinition,
  isCatalogTag,
  tagsFor,
  tagLabel,
  tagTone,
} from "./people-tags";

describe("behavioural tag taxonomy", () => {
  it("every catalogue tag has a slug, label, explanation, and behaviour", () => {
    for (const def of TAG_CATALOGUE) {
      expect(def.slug).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.explanation.length).toBeGreaterThan(0);
      expect(def.appearsIn.length).toBeGreaterThan(0);
      expect(def.appliesTo.length).toBeGreaterThan(0);
    }
  });

  it("resolves a tag by slug and by label, case-insensitively", () => {
    expect(getTagDefinition("key-stakeholder")?.label).toBe("Key stakeholder");
    expect(getTagDefinition("Key stakeholder")?.slug).toBe("key-stakeholder");
    expect(getTagDefinition("KEY-STAKEHOLDER")?.slug).toBe("key-stakeholder");
    expect(getTagDefinition("not-a-real-tag")).toBeNull();
  });

  it("distinguishes catalogue tags from free-text tags", () => {
    expect(isCatalogTag("follow-up-required")).toBe(true);
    expect(isCatalogTag("DevOps")).toBe(false);
    expect(tagLabel("DevOps")).toBe("DevOps");
    expect(tagTone("DevOps")).toBe("neutral");
  });

  it("wires the cheap-win behaviours expected by the server", () => {
    expect(getTagDefinition("follow-up-required")?.behaviour).toMatchObject({
      kind: "suggest_action",
      wired: true,
    });
    expect(getTagDefinition("do-not-surface-unless-relevant")?.behaviour).toMatchObject({
      kind: "reduce_noise",
      wired: true,
    });
    const stakeholder = getTagDefinition("key-stakeholder")?.behaviour;
    expect(stakeholder?.kind).toBe("raise_importance");
    expect(stakeholder?.importanceFloor).toBe("high");
    expect(stakeholder?.wired).toBe(true);
  });

  it("classification-only tags are documented but not wired in this pass", () => {
    expect(getTagDefinition("decision-maker")?.behaviour).toMatchObject({
      kind: "classify",
      wired: false,
    });
  });

  it("scopes person-only tags out of the company catalogue", () => {
    const companyTags = tagsFor("company").map((t) => t.slug);
    expect(companyTags).not.toContain("follow-up-required");
    expect(companyTags).not.toContain("decision-maker");
    expect(tagsFor("person").map((t) => t.slug)).toContain("follow-up-required");
    expect(companyTags).toContain("client");
  });
});
