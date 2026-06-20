"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createSkillAction } from "../actions";
import {
  SkillFields,
  EMPTY_SKILL_BEHAVIOUR,
  type SkillFieldsValue,
} from "@/components/skills/skill-fields";

export function SkillCreate() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [behaviour, setBehaviour] = useState<SkillFieldsValue>(
    EMPTY_SKILL_BEHAVIOUR,
  );

  function save() {
    setMessage(null);
    startTransition(async () => {
      const res = await createSkillAction({ name, purpose, behaviour });
      if (res.ok && res.skillId)
        router.push(`/intelligence/skills/${res.skillId}`);
      else setMessage(res.error ?? "Could not create the skill.");
    });
  }

  return (
    <div
      className="workspace__content--narrow"
      style={{ marginInline: "auto", width: "100%" }}
    >
      <Link href="/intelligence/skills" className="back-link">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Custom skills
      </Link>

      <div className="page-head">
        <h1 className="page-head__title" style={{ marginTop: 0 }}>
          New skill
        </h1>
        <p className="page-head__lead">
          Describe a way of working you want to reuse. Once it is saved, you can
          attach it to any prompt — and it will guide Pilot alongside your
          manifesto.
        </p>
      </div>

      <section className="card">
        <div className="stack" style={{ gap: "var(--space-md)" }}>
          <div className="field">
            <label className="label" htmlFor="skill-name">
              Name
            </label>
            <input
              id="skill-name"
              className="input"
              value={name}
              placeholder="e.g. Board-ready summarising"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="skill-purpose">
              Purpose
            </label>
            <input
              id="skill-purpose"
              className="input"
              value={purpose}
              placeholder="One line on what this skill is for"
              onChange={(e) => setPurpose(e.target.value)}
            />
          </div>

          <SkillFields
            value={behaviour}
            onChange={setBehaviour}
            disabled={pending}
          />

          <div style={{ display: "flex", gap: "var(--space-sm)" }}>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={save}
              disabled={
                pending || !name.trim() || !behaviour.instructions.trim()
              }
            >
              {pending ? "Creating…" : "Create skill"}
            </button>
            <Link
              href="/intelligence/skills"
              className="btn btn--ghost btn--sm"
            >
              Cancel
            </Link>
          </div>
          {message ? (
            <p className="form-message form-message--error">{message}</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
