import { describe, expect, it } from "vitest";
import {
  PROMPT_PURPOSE_BY_KEY,
  PROMPT_PURPOSE_ORDER,
  PROMPT_PURPOSE_SUMMARY,
  PROMPT_WORKFLOW_LABELS,
  derivePromptProvenance,
  type PromptTemplateKey,
} from "./index";
import { DEFAULT_PROMPT_CATALOGUE, getPromptDefault } from "./defaults";
import {
  DEFAULT_SKILL_CATALOGUE,
  getSkillDefault,
} from "@/modules/custom-skills";
import {
  DEFAULT_MANIFESTO_BODY,
  DEFAULT_MANIFESTO_PRINCIPLES,
} from "@/modules/manager-manifesto";

const ALL_KEYS = Object.keys(PROMPT_WORKFLOW_LABELS) as PromptTemplateKey[];

describe("prompt taxonomy", () => {
  it("every template key has a purpose, summary, and that purpose is ordered", () => {
    for (const key of ALL_KEYS) {
      expect(PROMPT_PURPOSE_BY_KEY[key], `purpose for ${key}`).toBeDefined();
      expect(PROMPT_PURPOSE_SUMMARY[key], `summary for ${key}`).toBeTruthy();
      expect(PROMPT_PURPOSE_ORDER).toContain(PROMPT_PURPOSE_BY_KEY[key]);
    }
  });

  it("the default catalogue covers every template key with valid content", () => {
    for (const key of ALL_KEYS) {
      const def = getPromptDefault(key);
      expect(def.content.trim().length, `content for ${key}`).toBeGreaterThan(
        0,
      );
      expect(PROMPT_PURPOSE_ORDER).toContain(def.purpose);
      expect(def.outputFormat.schemaId).toBeTruthy();
    }
    expect(DEFAULT_PROMPT_CATALOGUE.length).toBe(ALL_KEYS.length);
  });

  it("derives provenance honestly from the active version number", () => {
    expect(derivePromptProvenance(null)).toBe("system_default");
    expect(derivePromptProvenance(1)).toBe("system_default");
    expect(derivePromptProvenance(2)).toBe("custom");
    expect(derivePromptProvenance(7)).toBe("custom");
  });
});

describe("default skill catalogue", () => {
  it("ships ten skills with unique keys and real instructions", () => {
    expect(DEFAULT_SKILL_CATALOGUE.length).toBe(10);
    const keys = new Set(DEFAULT_SKILL_CATALOGUE.map((s) => s.skillKey));
    expect(keys.size).toBe(10);
    for (const skill of DEFAULT_SKILL_CATALOGUE) {
      expect(
        skill.instructions.trim().length,
        `${skill.skillKey} instructions`,
      ).toBeGreaterThan(0);
      expect(skill.name.trim().length).toBeGreaterThan(0);
      expect(
        skill.safetyConstraints.trim().length,
        `${skill.skillKey} safety`,
      ).toBeGreaterThan(0);
    }
  });

  it("looks up a default skill by key", () => {
    expect(getSkillDefault("risk_spotting")?.name).toBe("Risk spotting");
    expect(getSkillDefault("does_not_exist")).toBeUndefined();
  });
});

describe("default manifesto", () => {
  it("ships a substantial default with structured principles", () => {
    expect(DEFAULT_MANIFESTO_BODY.length).toBeGreaterThan(400);
    expect(DEFAULT_MANIFESTO_BODY).toContain("lead with clarity");
    expect(DEFAULT_MANIFESTO_PRINCIPLES.length).toBeGreaterThan(3);
  });
});
