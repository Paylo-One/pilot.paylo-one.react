/**
 * Prompt detail — one prompt's full management surface: what it does and where
 * it is used, the live version, the skills applied to it, an automatic
 * safeguards check, the append-only version history (edit = new version,
 * compare, restore, activate, archive), the test panel that runs a version
 * against real information through the governed Model Gateway, and the audit
 * trail.
 *
 * Server Component: loads the prompt + versions + skills + linked-skill ids +
 * recent test runs + the prompt's audit slice; the interactive panels are
 * client components.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { isPrivilegedRole } from "@/modules/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listRecentSourceItems } from "@/modules/knowledge-store/server";
import {
  getTenantPrompt,
  listTestRuns,
} from "@/modules/prompt-versioning/server";
import { listSkills } from "@/modules/custom-skills/server";
import {
  PROMPT_PURPOSE_SUMMARY,
  PROMPT_WORKFLOW_LABELS,
  type PromptTemplateKey,
} from "@/modules/prompt-versioning";
import { PromptMeta } from "@/components/prompts/prompt-meta";
import { VersionHistory } from "@/components/prompts/version-history";
import { TestPanel } from "@/components/prompts/test-panel";
import { LinkedSkills } from "@/components/prompts/linked-skills";

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface AuditRow {
  id: string;
  action: string;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
}

const AUDIT_LABELS: Record<string, string> = {
  "prompt.version.created": "Draft saved",
  "prompt.version.activated": "Version published",
  "prompt.version.archived": "Version archived",
  "prompt.version.restored": "Version restored",
  "prompt.updated": "Details updated",
  "prompt.archived": "Prompt archived",
  "prompt.unarchived": "Prompt restored",
  "prompt.test.run": "Test run",
  "prompt.evaluation.run": "Evaluated",
  "prompt.skill.linked": "Skill applied",
  "prompt.skill.unlinked": "Skill removed",
  "prompt.defaults.seeded": "Defaults seeded",
  "prompt.defaults.reset": "Reset to default",
};

/** Lightweight, advisory checks on the live prompt content. */
function safeguardWarnings(content: string): string[] {
  const warnings: string[] = [];
  if (!/\b(source|cite|citation|reference|item-?\d|item id)\b/i.test(content)) {
    warnings.push(
      "This prompt does not ask Pilot to cite its sources. Outputs may be harder to trust and verify.",
    );
  }
  if (
    /\b(ignore|disregard|forget)\b.{0,24}\b(previous|above|earlier)\b.{0,16}\binstruction/i.test(
      content,
    )
  ) {
    warnings.push(
      "This prompt contains phrasing that can weaken Pilot's defences against injected instructions in your content.",
    );
  }
  if (
    /\b(ssn|password|api key|secret key|credit card|bank account)\b/i.test(
      content,
    )
  ) {
    warnings.push(
      "This prompt references sensitive data. Make sure it is not asking Pilot to surface or reproduce it.",
    );
  }
  return warnings;
}

export default async function PromptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireTenantContext();
  const { id } = await params;
  const canEdit = isPrivilegedRole(ctx.role);

  const detail = await getTenantPrompt(ctx, id);
  if (!detail.ok) notFound();
  const prompt = detail.value;

  const supabase = await createSupabaseServerClient();
  const [testRuns, recentItems, skillsRes, linkRows, auditRes] =
    await Promise.all([
      listTestRuns(ctx, id, 5),
      listRecentSourceItems(ctx.tenantId, 20),
      listSkills(ctx),
      supabase
        .from("prompt_skill_links")
        .select("custom_skill_id")
        .eq("tenant_prompt_id", id),
      supabase
        .from("audit_events")
        .select("id, action, metadata, occurred_at")
        .eq("target", id)
        .like("action", "prompt.%")
        .order("occurred_at", { ascending: false })
        .limit(20),
    ]);

  const audit = (auditRes.data ?? []) as AuditRow[];
  const skills = skillsRes.ok ? skillsRes.value : [];
  const linkedSkillIds = (linkRows.data ?? []).map(
    (r) => r.custom_skill_id as string,
  );

  const activeVersion =
    prompt.versions.find((v) => v.status === "active") ?? null;
  const warnings = activeVersion
    ? safeguardWarnings(activeVersion.content)
    : [];

  return (
    <div
      className="workspace__content--narrow"
      style={{ marginInline: "auto", width: "100%" }}
    >
      <Link href="/intelligence/prompts" className="back-link">
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
        Prompt library
      </Link>

      <div className="page-head">
        <div className="source-head">
          <div className="source-head__id">
            <h1 className="page-head__title" style={{ marginTop: 0 }}>
              {prompt.name}
            </h1>
            <p className="integration__kind">{prompt.purpose}</p>
          </div>
          {prompt.archivedAt ? (
            <span className="status status--neutral">Archived</span>
          ) : activeVersion ? (
            <span className="status status--ok">
              Active · v{activeVersion.versionNumber}
            </span>
          ) : (
            <span className="status status--warn">No active version</span>
          )}
        </div>
        <p className="page-head__lead">
          {prompt.description ??
            PROMPT_PURPOSE_SUMMARY[prompt.templateKey as PromptTemplateKey] ??
            ""}
        </p>
        <div className="source-head__badges">
          <span className="badge badge--plain">
            {PROMPT_WORKFLOW_LABELS[prompt.templateKey as PromptTemplateKey] ??
              prompt.workflow}
          </span>
          <span className="badge badge--plain">
            {prompt.versions.length} version
            {prompt.versions.length === 1 ? "" : "s"}
          </span>
          {!canEdit ? (
            <span className="badge badge--plain">View only</span>
          ) : null}
        </div>
      </div>

      <div className="stack" style={{ gap: "var(--space-lg)" }}>
        <PromptMeta prompt={prompt} />

        {/* --- Safeguards ---------------------------------------------------- */}
        {warnings.length > 0 ? (
          <div className="alert alert--warn">
            <div>
              <p className="alert__title">
                Worth a second look before you publish
              </p>
              <ul
                className="stack"
                style={{ gap: "var(--space-xs)", marginTop: "var(--space-xs)" }}
              >
                {warnings.map((w) => (
                  <li key={w} className="alert__body">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {/* --- Active version ------------------------------------------------ */}
        <section className="card">
          <div className="card-head">
            <h2 className="card__title">Live version</h2>
            {activeVersion ? (
              <span className="badge badge--plain">
                v{activeVersion.versionNumber}
              </span>
            ) : null}
          </div>
          {activeVersion ? (
            <div className="stack" style={{ gap: "var(--space-md)" }}>
              <pre className="prompt-content mono">{activeVersion.content}</pre>
              <div className="grid grid--2">
                <div>
                  <p
                    className="eyebrow"
                    style={{ marginBottom: "var(--space-sm)" }}
                  >
                    What Pilot is given
                  </p>
                  {activeVersion.inputVariables.length === 0 ? (
                    <p className="scaffold-note">No inputs declared.</p>
                  ) : (
                    <ul className="stack" style={{ gap: "var(--space-sm)" }}>
                      {activeVersion.inputVariables.map((v) => (
                        <li key={v.name}>
                          <span className="mono">{`{{${v.name}}}`}</span>
                          {v.required ? (
                            <span className="badge badge--plain">required</span>
                          ) : null}
                          <p className="scaffold-note" style={{ margin: 0 }}>
                            {v.description}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p
                    className="eyebrow"
                    style={{ marginBottom: "var(--space-sm)" }}
                  >
                    Output &amp; model
                  </p>
                  <div className="meta-row">
                    <span className="meta-row__key">Output shape</span>
                    <span className="meta-row__value mono">
                      {activeVersion.outputFormat.schemaId ?? "—"}
                    </span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-row__key">Temperature</span>
                    <span className="meta-row__value mono">
                      {activeVersion.modelSettings.temperature ?? "—"}
                    </span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-row__key">Max length</span>
                    <span className="meta-row__value mono">
                      {activeVersion.modelSettings.maxTokens ?? "—"}
                    </span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-row__key">Published</span>
                    <span className="meta-row__value mono">
                      {formatTimestamp(activeVersion.activatedAt)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty">
              <p className="empty__title">No version is live yet</p>
              <p className="empty__body">
                Until you publish a version, this workflow uses Pilot&rsquo;s
                built-in default.
              </p>
            </div>
          )}
        </section>

        <LinkedSkills
          promptId={prompt.id}
          skills={skills}
          linkedSkillIds={linkedSkillIds}
          canEdit={canEdit}
        />

        {canEdit ? <VersionHistory prompt={prompt} /> : null}

        <TestPanel
          prompt={prompt}
          recentItems={recentItems.map((item) => ({
            id: item.id,
            system: item.system,
            title: item.title ?? "(untitled)",
            occurredAt: item.occurredAt ?? item.createdAt,
          }))}
          recentRuns={testRuns.ok ? testRuns.value : []}
        />

        {/* --- Audit history -------------------------------------------------- */}
        <section className="card">
          <div className="card-head">
            <h2 className="card__title">History</h2>
          </div>
          {audit.length === 0 ? (
            <p className="scaffold-note">No changes recorded yet.</p>
          ) : (
            <ul className="stack" style={{ gap: "var(--space-sm)" }}>
              {audit.map((event) => {
                const versionNumber = event.metadata?.versionNumber;
                return (
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
                    <span>
                      {AUDIT_LABELS[event.action] ?? event.action}
                      {typeof versionNumber === "number" ? (
                        <span
                          className="badge badge--plain"
                          style={{ marginLeft: "var(--space-sm)" }}
                        >
                          v{versionNumber}
                        </span>
                      ) : null}
                    </span>
                    <span className="mono text-tertiary">
                      {formatTimestamp(event.occurred_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
