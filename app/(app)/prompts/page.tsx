/**
 * Prompts — the tenant's prompt library. Every AI workflow (briefing
 * generation, signal classification, ranking, triage) resolves its system
 * prompt from this library, so operators can refine how the system thinks —
 * with versioning, audit, and test-before-activate on the detail view.
 *
 * Server Component: loads (and lazily seeds) the tenant's prompt library, then
 * hands it to the client browser for filtering.
 * Governance: services/prompt-versioning-service.md.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import { listTenantPrompts } from "@/modules/prompt-versioning/server";
import { PromptsBrowser } from "./prompts-browser";

export default async function PromptsPage() {
  const ctx = await requireTenantContext();
  const prompts = await listTenantPrompts(ctx);

  return (
    <main className="workspace__content">
      <div className="page-head">
        <p className="eyebrow">Prompts</p>
        <h1 className="page-head__title">Prompt library</h1>
        <p className="page-head__lead">
          The instructions that decide how your workspace classifies, ranks,
          triages, and briefs. Each prompt is private to your workspace and
          versioned: edits never overwrite, every change is kept on record, and
          you can test a draft against real signals before activating it.
        </p>
      </div>

      {prompts.ok ? (
        <PromptsBrowser prompts={prompts.value} />
      ) : (
        <div className="alert alert--warn">
          <div>
            <p className="alert__body">
              The prompt library could not be loaded: {prompts.error.message}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
