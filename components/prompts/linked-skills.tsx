"use client";

/**
 * Linked skills for one prompt: the custom skills folded into this prompt's
 * system instruction when it runs. Owners and admins can attach or detach a
 * skill; the change takes effect on the next run.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setPromptSkillLinkAction } from "@/app/(app)/intelligence/skills/actions";
import type { CustomSkillSummary } from "@/modules/custom-skills";

export function LinkedSkills({
  promptId,
  skills,
  linkedSkillIds,
  canEdit,
}: {
  promptId: string;
  skills: readonly CustomSkillSummary[];
  linkedSkillIds: readonly string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [linked, setLinked] = useState<Set<string>>(new Set(linkedSkillIds));

  const available = skills.filter(
    (s) => !s.archivedAt && s.activeVersionNumber !== null,
  );

  function toggle(skillId: string, next: boolean) {
    setMessage(null);
    setLinked((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(skillId);
      else copy.delete(skillId);
      return copy;
    });
    startTransition(async () => {
      const res = await setPromptSkillLinkAction({
        tenantPromptId: promptId,
        customSkillId: skillId,
        linked: next,
      });
      if (res.ok) router.refresh();
      else {
        setMessage(res.error);
        // Roll the optimistic toggle back on failure.
        setLinked((prev) => {
          const copy = new Set(prev);
          if (next) copy.delete(skillId);
          else copy.add(skillId);
          return copy;
        });
      }
    });
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card__title">Skills applied</h2>
        <Link href="/intelligence/skills" className="btn btn--ghost btn--sm">
          Manage skills
        </Link>
      </div>
      <p className="scaffold-note" style={{ marginBottom: "var(--space-md)" }}>
        Skills are reusable ways of working that fold into this prompt when it
        runs — alongside your manifesto. Attach the ones that fit how you want
        this handled.
      </p>

      {available.length === 0 ? (
        <p className="scaffold-note">No skills are available yet.</p>
      ) : (
        <ul className="stack" style={{ gap: "var(--space-sm)" }}>
          {available.map((skill) => {
            const isLinked = linked.has(skill.id);
            return (
              <li
                key={skill.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--space-md)",
                  paddingBottom: "var(--space-sm)",
                  borderBottom: "1px solid var(--colour-border)",
                }}
              >
                <div>
                  <p className="integration__name" style={{ margin: 0 }}>
                    {skill.name}
                  </p>
                  <p className="scaffold-note" style={{ margin: 0 }}>
                    {skill.purpose}
                  </p>
                </div>
                {canEdit ? (
                  <button
                    type="button"
                    className={`filter-chip${isLinked ? " filter-chip--active" : ""}`}
                    disabled={pending}
                    aria-pressed={isLinked}
                    onClick={() => toggle(skill.id, !isLinked)}
                  >
                    {isLinked ? "Applied" : "Apply"}
                  </button>
                ) : isLinked ? (
                  <span className="status status--ok">Applied</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {message ? (
        <p className="form-message form-message--error">{message}</p>
      ) : null}
    </section>
  );
}
