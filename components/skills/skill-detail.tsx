"use client";

/**
 * One skill's management surface: the live behaviour, an editor that appends a
 * new draft (editing never overwrites), the version history with publish and
 * restore, and the prompts this skill is applied to. Editing is reserved for
 * owners and admins; everyone else sees a calm, read-only view.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  CustomSkillDetail,
  CustomSkillVersion,
} from "@/modules/custom-skills";
import {
  activateSkillVersionAction,
  createSkillVersionAction,
  restoreSkillVersionAction,
  setSkillArchivedAction,
} from "@/app/(app)/intelligence/skills/actions";
import { SkillFields, type SkillFieldsValue } from "./skill-fields";

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_TONE: Record<CustomSkillVersion["status"], string> = {
  active: "ok",
  draft: "info",
  archived: "neutral",
};

function behaviourOf(v: CustomSkillVersion): SkillFieldsValue {
  return {
    instructions: v.instructions,
    whenToUse: v.whenToUse,
    whenNotToUse: v.whenNotToUse,
    outputFormat: v.outputFormat,
    toneGuidance: v.toneGuidance,
    requiredContext: v.requiredContext,
    safetyConstraints: v.safetyConstraints,
  };
}

const FIELD_LABELS: Array<[keyof SkillFieldsValue, string]> = [
  ["instructions", "How Pilot works"],
  ["whenToUse", "When to use it"],
  ["whenNotToUse", "When not to use it"],
  ["outputFormat", "What the result looks like"],
  ["toneGuidance", "Tone"],
  ["requiredContext", "What it needs"],
  ["safetyConstraints", "Guardrails"],
];

export function SkillDetail({
  skill,
  linkedPrompts,
  canEdit,
}: {
  skill: CustomSkillDetail;
  linkedPrompts: ReadonlyArray<{ id: string; name: string }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const active = useMemo(
    () => skill.versions.find((v) => v.status === "active") ?? null,
    [skill.versions],
  );
  const latest = skill.versions[0] ?? null;

  const [editorOpen, setEditorOpen] = useState(false);
  const [behaviour, setBehaviour] = useState<SkillFieldsValue | null>(null);
  const [changeNote, setChangeNote] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error: string | null }>) {
    setMessage(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) router.refresh();
      else setMessage(res.error);
    });
  }

  function openEditor() {
    setBehaviour(latest ? behaviourOf(latest) : null);
    setChangeNote("");
    setEditorOpen(true);
  }

  function saveDraft() {
    if (!behaviour) return;
    setMessage(null);
    startTransition(async () => {
      const res = await createSkillVersionAction({
        customSkillId: skill.id,
        behaviour,
        changeNote: changeNote || undefined,
      });
      if (res.ok) {
        setEditorOpen(false);
        router.refresh();
      } else {
        setMessage(res.error);
      }
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
        <div className="source-head">
          <div className="source-head__id">
            <h1 className="page-head__title" style={{ marginTop: 0 }}>
              {skill.name}
            </h1>
            <p className="integration__kind">
              {skill.origin === "system_default"
                ? "Built-in skill"
                : "Custom skill"}
            </p>
          </div>
          {skill.archivedAt ? (
            <span className="status status--neutral">Archived</span>
          ) : active ? (
            <span className="status status--ok">
              Active · v{active.versionNumber}
            </span>
          ) : (
            <span className="status status--warn">Draft</span>
          )}
        </div>
        {skill.purpose ? (
          <p className="page-head__lead">{skill.purpose}</p>
        ) : null}
        <div className="source-head__badges">
          <span className="badge badge--plain">
            {linkedPrompts.length} prompt{linkedPrompts.length === 1 ? "" : "s"}
          </span>
          {!canEdit ? (
            <span className="badge badge--plain">View only</span>
          ) : null}
        </div>
      </div>

      <div className="stack" style={{ gap: "var(--space-lg)" }}>
        {/* --- Live behaviour ------------------------------------------------- */}
        <section className="card">
          <div className="card-head">
            <h2 className="card__title">What this skill does</h2>
            {canEdit && !editorOpen ? (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={openEditor}
                disabled={pending}
              >
                Edit
              </button>
            ) : null}
          </div>
          {active ? (
            <dl className="stack" style={{ gap: "var(--space-md)", margin: 0 }}>
              {FIELD_LABELS.map(([key, label]) =>
                active[key] ? (
                  <div key={key}>
                    <dt
                      className="eyebrow"
                      style={{ marginBottom: "var(--space-xs)" }}
                    >
                      {label}
                    </dt>
                    <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                      {active[key]}
                    </dd>
                  </div>
                ) : null,
              )}
            </dl>
          ) : (
            <p className="scaffold-note">No version is live yet.</p>
          )}
        </section>

        {/* --- New version editor -------------------------------------------- */}
        {canEdit && editorOpen && behaviour ? (
          <section className="card">
            <div className="card-head">
              <h2 className="card__title">New version</h2>
            </div>
            <p
              className="scaffold-note"
              style={{ marginBottom: "var(--space-md)" }}
            >
              Editing never overwrites. This saves a new draft you can publish
              when you are ready; the current version stays live until you do.
            </p>
            <div className="stack" style={{ gap: "var(--space-md)" }}>
              <SkillFields
                value={behaviour}
                onChange={setBehaviour}
                disabled={pending}
              />
              <div className="field">
                <label className="label" htmlFor="skill-change-note">
                  What changed, and why?
                </label>
                <input
                  id="skill-change-note"
                  className="input"
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                />
              </div>
              <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={saveDraft}
                  disabled={pending || !behaviour.instructions.trim()}
                >
                  {pending ? "Saving…" : "Save as draft"}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setEditorOpen(false)}
                  disabled={pending}
                >
                  Cancel
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {/* --- Version history ------------------------------------------------ */}
        <section className="card">
          <div className="card-head">
            <h2 className="card__title">Versions</h2>
          </div>
          <ul className="stack" style={{ gap: "var(--space-md)" }}>
            {skill.versions.map((version) => {
              const expanded = expandedId === version.id;
              return (
                <li
                  key={version.id}
                  style={{
                    paddingBottom: "var(--space-md)",
                    borderBottom: "1px solid var(--colour-border)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "var(--space-md)",
                      flexWrap: "wrap",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-sm)",
                      }}
                    >
                      <span className="badge badge--plain">
                        v{version.versionNumber}
                      </span>
                      <span
                        className={`status status--${STATUS_TONE[version.status]}`}
                      >
                        {version.status}
                      </span>
                      <span className="mono text-tertiary">
                        {formatTimestamp(version.createdAt)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: "var(--space-xs)",
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() =>
                          setExpandedId(expanded ? null : version.id)
                        }
                      >
                        {expanded ? "Hide" : "View"}
                      </button>
                      {canEdit && version.status !== "active" ? (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() =>
                            run(() =>
                              activateSkillVersionAction({
                                versionId: version.id,
                              }),
                            )
                          }
                          disabled={pending}
                        >
                          Publish
                        </button>
                      ) : null}
                      {canEdit && version.status === "archived" ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() =>
                            run(() =>
                              restoreSkillVersionAction({
                                versionId: version.id,
                              }),
                            )
                          }
                          disabled={pending}
                        >
                          Restore
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {version.changeNote ? (
                    <p
                      className="scaffold-note"
                      style={{ margin: "var(--space-xs) 0 0" }}
                    >
                      {version.changeNote}
                    </p>
                  ) : null}
                  {expanded ? (
                    <div
                      className="stack"
                      style={{
                        gap: "var(--space-sm)",
                        marginTop: "var(--space-sm)",
                      }}
                    >
                      {FIELD_LABELS.map(([key, label]) =>
                        version[key] ? (
                          <div key={key}>
                            <p
                              className="eyebrow"
                              style={{ marginBottom: "var(--space-2xs)" }}
                            >
                              {label}
                            </p>
                            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                              {version[key]}
                            </p>
                          </div>
                        ) : null,
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        {/* --- Where it is used ---------------------------------------------- */}
        <section className="card">
          <div className="card-head">
            <h2 className="card__title">Applied to</h2>
          </div>
          {linkedPrompts.length === 0 ? (
            <p className="scaffold-note">
              Not applied to any prompt yet. Open a prompt and apply this skill
              from there.
            </p>
          ) : (
            <ul className="stack" style={{ gap: "var(--space-sm)" }}>
              {linkedPrompts.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/intelligence/prompts/${p.id}`}
                    className="catalogue-card__action"
                  >
                    {p.name}
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {canEdit && skill.origin === "custom" ? (
          <div>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() =>
                run(() =>
                  setSkillArchivedAction({
                    skillId: skill.id,
                    archived: !skill.archivedAt,
                  }),
                )
              }
              disabled={pending}
            >
              {skill.archivedAt ? "Restore skill" : "Archive skill"}
            </button>
          </div>
        ) : null}

        {message ? (
          <p className="form-message form-message--error">{message}</p>
        ) : null}
      </div>
    </div>
  );
}
