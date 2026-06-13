/**
 * Prompt detail — one prompt's full management surface: metadata, the active
 * version, the append-only version history (edit = new version, compare,
 * restore, activate, archive), the audit trail, and the test panel that runs a
 * version against real signals through the governed Model Gateway before it
 * is activated.
 *
 * Server Component: loads the prompt + versions + recent test runs + the
 * prompt's audit slice; the interactive panels are client components.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantContext } from "@/modules/identity-tenant/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listRecentSourceItems } from "@/modules/knowledge-store/server";
import { getTenantPrompt, listTestRuns } from "@/modules/prompt-versioning/server";
import { PROMPT_WORKFLOW_LABELS } from "@/modules/prompt-versioning";
import { PromptMeta } from "@/components/prompts/prompt-meta";
import { VersionHistory } from "@/components/prompts/version-history";
import { TestPanel } from "@/components/prompts/test-panel";

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
  "prompt.version.created": "Version created",
  "prompt.version.activated": "Version activated",
  "prompt.version.archived": "Version archived",
  "prompt.version.restored": "Version restored",
  "prompt.updated": "Details updated",
  "prompt.archived": "Prompt archived",
  "prompt.unarchived": "Prompt unarchived",
  "prompt.test.run": "Test run",
  "prompt.defaults.seeded": "Defaults seeded",
  "prompt.defaults.reset": "Reset to default",
};

export default async function PromptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireTenantContext();
  const { id } = await params;

  const detail = await getTenantPrompt(ctx, id);
  if (!detail.ok) notFound();
  const prompt = detail.value;

  const [testRuns, recentItems] = await Promise.all([
    listTestRuns(ctx, id, 5),
    listRecentSourceItems(ctx.tenantId, 20),
  ]);

  // The prompt's audit slice (RLS-scoped read; writes are server-only).
  const supabase = await createSupabaseServerClient();
  const { data: auditRows } = await supabase
    .from("audit_events")
    .select("id, action, metadata, occurred_at")
    .eq("target", id)
    .like("action", "prompt.%")
    .order("occurred_at", { ascending: false })
    .limit(20);
  const audit = (auditRows ?? []) as AuditRow[];

  const activeVersion = prompt.versions.find((v) => v.status === "active") ?? null;

  return (
    <main className="workspace__content workspace__content--narrow">
      <Link href="/prompts" className="back-link">
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
        All prompts
      </Link>

      <div className="page-head">
        <div className="source-head">
          <div className="source-head__id">
            <h1 className="page-head__title" style={{ marginTop: 0 }}>
              {prompt.name}
            </h1>
            <p className="integration__kind">
              {PROMPT_WORKFLOW_LABELS[prompt.templateKey]}
            </p>
          </div>
          {prompt.archivedAt ? (
            <span className="status status--neutral">Archived</span>
          ) : activeVersion ? (
            <span className="status status--ok">Active · v{activeVersion.versionNumber}</span>
          ) : (
            <span className="status status--warn">No active version</span>
          )}
        </div>
        {prompt.description ? (
          <p className="page-head__lead">{prompt.description}</p>
        ) : null}
        <div className="source-head__badges">
          <span className="badge badge--plain">
            Catalogue {prompt.catalogueVersion}
          </span>
          <span className="badge">
            {prompt.versions.length} version{prompt.versions.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className="stack" style={{ gap: "var(--space-lg)" }}>
        <PromptMeta prompt={prompt} />

        {/* --- Active version ------------------------------------------------ */}
        <section className="card">
          <div className="card-head">
            <h2 className="card__title">Active version</h2>
            {activeVersion ? (
              <span className="badge">v{activeVersion.versionNumber}</span>
            ) : null}
          </div>
          {activeVersion ? (
            <div className="stack" style={{ gap: "var(--space-md)" }}>
              <pre className="prompt-content mono">{activeVersion.content}</pre>
              <div className="grid grid--2">
                <div>
                  <p className="eyebrow" style={{ marginBottom: "var(--space-sm)" }}>
                    Input variables
                  </p>
                  {activeVersion.inputVariables.length === 0 ? (
                    <p className="scaffold-note">None declared.</p>
                  ) : (
                    <ul className="stack" style={{ gap: "var(--space-sm)" }}>
                      {activeVersion.inputVariables.map((v) => (
                        <li key={v.name}>
                          <span className="mono">{`{{${v.name}}}`}</span>
                          {v.required ? <span className="badge badge--plain">required</span> : null}
                          <p className="scaffold-note" style={{ margin: 0 }}>
                            {v.description}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="scaffold-note" style={{ marginTop: "var(--space-sm)" }}>
                    Variables document the context the system supplies at run
                    time; the runtime folds it into the user message.
                  </p>
                </div>
                <div>
                  <p className="eyebrow" style={{ marginBottom: "var(--space-sm)" }}>
                    Output & model
                  </p>
                  <div className="meta-row">
                    <span className="meta-row__key">Output schema</span>
                    <span className="meta-row__value mono">
                      {activeVersion.outputFormat.schemaId ?? "—"}
                    </span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-row__key">Model policy</span>
                    <span className="meta-row__value mono">
                      {activeVersion.modelSettings.policyName ?? "default"}
                    </span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-row__key">Temperature</span>
                    <span className="meta-row__value mono">
                      {activeVersion.modelSettings.temperature ?? "—"}
                    </span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-row__key">Max tokens</span>
                    <span className="meta-row__value mono">
                      {activeVersion.modelSettings.maxTokens ?? "—"}
                    </span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-row__key">Activated</span>
                    <span className="meta-row__value mono">
                      {formatTimestamp(activeVersion.activatedAt)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty">
              <p className="empty__title">No active version</p>
              <p className="empty__body">
                This workflow falls back to the built-in default prompt until a
                version is activated below.
              </p>
            </div>
          )}
        </section>

        <VersionHistory prompt={prompt} />

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
            <h2 className="card__title">Audit history</h2>
          </div>
          {audit.length === 0 ? (
            <p className="scaffold-note">No prompt events recorded yet.</p>
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
                        <span className="badge badge--plain" style={{ marginLeft: "var(--space-sm)" }}>
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
    </main>
  );
}
