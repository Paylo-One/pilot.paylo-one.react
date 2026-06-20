/**
 * Intelligence · Overview — a calm read on what Pilot is currently instructed
 * to do: the active manifesto, the shape of the prompt library and skills, what
 * is in draft awaiting review, and the most recent changes. An editorial status
 * surface, not a metrics dashboard.
 */

import Link from "next/link";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listTenantPrompts } from "@/modules/prompt-versioning/server";
import { listSkills } from "@/modules/custom-skills/server";
import { getManifesto } from "@/modules/manager-manifesto/server";

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

const AUDIT_LABELS: Record<string, string> = {
  "prompt.version.created": "Prompt draft saved",
  "prompt.version.activated": "Prompt version published",
  "prompt.version.archived": "Prompt version archived",
  "prompt.version.restored": "Prompt version restored",
  "prompt.updated": "Prompt details updated",
  "prompt.defaults.reset": "Prompt reset to default",
  "prompt.skill.linked": "Skill linked to prompt",
  "prompt.skill.unlinked": "Skill unlinked from prompt",
  "prompt.evaluation.run": "Prompt evaluated",
  "custom_skill.created": "Skill created",
  "custom_skill.version.created": "Skill draft saved",
  "custom_skill.version.activated": "Skill version published",
  "custom_skill.updated": "Skill details updated",
  "custom_skill.archived": "Skill archived",
  "manifesto.version.created": "Manifesto draft saved",
  "manifesto.version.activated": "Manifesto published",
  "manifesto.version.restored": "Manifesto restored",
};

export default async function IntelligenceOverviewPage() {
  const ctx = await requireTenantContext();
  const [promptsRes, skillsRes, manifestoRes] = await Promise.all([
    listTenantPrompts(ctx),
    listSkills(ctx),
    getManifesto(ctx),
  ]);

  const prompts = promptsRes.ok ? promptsRes.value : [];
  const skills = skillsRes.ok ? skillsRes.value : [];
  const manifesto = manifestoRes.ok ? manifestoRes.value : null;
  const activeManifesto =
    manifesto?.versions.find((v) => v.status === "active") ?? null;

  const activePrompts = prompts.filter(
    (p) => p.activeVersionNumber !== null && !p.archivedAt,
  ).length;
  const customisedPrompts = prompts.filter(
    (p) => (p.activeVersionNumber ?? 0) > 1,
  ).length;
  const activeSkills = skills.filter(
    (s) => s.activeVersionNumber !== null && !s.archivedAt,
  ).length;

  // Recent changes across prompts, skills, and the manifesto.
  const supabase = await createSupabaseServerClient();
  const { data: auditRows } = await supabase
    .from("audit_events")
    .select("id, action, occurred_at")
    .or(
      "action.like.prompt.%,action.like.custom_skill.%,action.like.manifesto.%",
    )
    .order("occurred_at", { ascending: false })
    .limit(8);
  const recent = auditRows ?? [];

  const manifestoExcerpt = activeManifesto
    ? activeManifesto.body.split("\n").filter(Boolean).slice(0, 2).join(" ")
    : null;

  return (
    <div className="stack" style={{ gap: "var(--space-lg)" }}>
      {/* --- Active manifesto -------------------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <h2 className="card__title">Your standing guidance</h2>
          {activeManifesto ? (
            <span className="status status--ok">
              Active · v{activeManifesto.versionNumber}
            </span>
          ) : (
            <span className="status status--warn">Not set</span>
          )}
        </div>
        {manifestoExcerpt ? (
          <p className="page-head__lead" style={{ marginTop: 0 }}>
            “{manifestoExcerpt}”
          </p>
        ) : (
          <p className="scaffold-note">
            Your Manager Manifesto guides every judgement Pilot makes. Set it
            once, and shape it as you learn what good looks like.
          </p>
        )}
        <Link
          href="/intelligence/manifesto"
          className="catalogue-card__action"
          style={{ marginTop: "var(--space-sm)" }}
        >
          Read and edit the manifesto
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
      </section>

      {/* --- At a glance ------------------------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <h2 className="card__title">At a glance</h2>
        </div>
        <div className="stack" style={{ gap: "var(--space-sm)" }}>
          <div className="meta-row">
            <span className="meta-row__key">Prompts guiding Pilot</span>
            <span className="meta-row__value">{activePrompts} active</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Prompts you have customised</span>
            <span className="meta-row__value">{customisedPrompts}</span>
          </div>
          <div className="meta-row">
            <span className="meta-row__key">Custom skills available</span>
            <span className="meta-row__value">{activeSkills}</span>
          </div>
        </div>
      </section>

      {/* --- Where to go ------------------------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <h2 className="card__title">Shape how Pilot works</h2>
        </div>
        <div className="catalogue-grid">
          <Link href="/intelligence/prompts" className="catalogue-card">
            <p className="integration__name">Prompt library</p>
            <p className="catalogue-card__desc">
              The instructions behind every briefing, classification, and
              extraction — grouped by what they do.
            </p>
          </Link>
          <Link href="/intelligence/skills" className="catalogue-card">
            <p className="integration__name">Custom skills</p>
            <p className="catalogue-card__desc">
              Reusable ways of working — executive summarising, risk spotting —
              you can attach to any prompt.
            </p>
          </Link>
          <Link href="/intelligence/testing" className="catalogue-card">
            <p className="integration__name">Testing lab</p>
            <p className="catalogue-card__desc">
              Try a change against your real information and see whether it is
              better before it goes live.
            </p>
          </Link>
        </div>
      </section>

      {/* --- Recent changes ---------------------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <h2 className="card__title">Recent changes</h2>
          <Link href="/intelligence/audit" className="btn btn--ghost btn--sm">
            View full history
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="scaffold-note">
            Nothing has changed yet. When you edit a prompt, skill, or your
            manifesto, it will appear here.
          </p>
        ) : (
          <ul className="stack" style={{ gap: "var(--space-sm)" }}>
            {recent.map((event) => (
              <li
                key={event.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "var(--space-md)",
                  paddingBottom: "var(--space-sm)",
                  borderBottom: "1px solid var(--colour-border)",
                }}
              >
                <span>{AUDIT_LABELS[event.action] ?? event.action}</span>
                <span className="mono text-tertiary">
                  {formatTimestamp(event.occurred_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
