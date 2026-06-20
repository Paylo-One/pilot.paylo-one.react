"use client";

/**
 * Shared, controlled field set for a custom skill's behaviour. Used by both the
 * create form and the new-version editor so a skill is described the same way
 * everywhere: plainly, in the operator's language.
 */

import type { SkillBehaviour } from "@/modules/custom-skills";

export interface SkillFieldsValue extends SkillBehaviour {}

const FIELDS: ReadonlyArray<{
  key: keyof SkillBehaviour;
  label: string;
  hint: string;
  rows: number;
}> = [
  {
    key: "instructions",
    label: "How Pilot should work",
    hint: "The behaviour this skill adds, in plain terms.",
    rows: 6,
  },
  {
    key: "whenToUse",
    label: "When to use it",
    hint: "The situations this skill is right for.",
    rows: 2,
  },
  {
    key: "whenNotToUse",
    label: "When not to use it",
    hint: "Where it would only add noise.",
    rows: 2,
  },
  {
    key: "outputFormat",
    label: "What the result should look like",
    hint: "The shape you want back.",
    rows: 2,
  },
  { key: "toneGuidance", label: "Tone", hint: "How it should read.", rows: 2 },
  {
    key: "requiredContext",
    label: "What it needs",
    hint: "The information Pilot needs to do this well.",
    rows: 2,
  },
  {
    key: "safetyConstraints",
    label: "Guardrails",
    hint: "What it must never do.",
    rows: 2,
  },
];

export function SkillFields({
  value,
  onChange,
  disabled,
}: {
  value: SkillFieldsValue;
  onChange: (next: SkillFieldsValue) => void;
  disabled?: boolean;
}) {
  return (
    <div className="stack" style={{ gap: "var(--space-md)" }}>
      {FIELDS.map((f) => (
        <div className="field" key={f.key}>
          <label className="label" htmlFor={`skill-${f.key}`}>
            {f.label}
          </label>
          <textarea
            id={`skill-${f.key}`}
            className="textarea"
            rows={f.rows}
            disabled={disabled}
            value={value[f.key]}
            placeholder={f.hint}
            onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
          />
        </div>
      ))}
    </div>
  );
}

export const EMPTY_SKILL_BEHAVIOUR: SkillFieldsValue = {
  instructions: "",
  whenToUse: "",
  whenNotToUse: "",
  outputFormat: "",
  toneGuidance: "",
  requiredContext: "",
  safetyConstraints: "",
};
