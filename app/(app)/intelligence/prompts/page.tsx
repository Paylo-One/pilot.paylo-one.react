/**
 * Intelligence · Prompt library — the tenant's prompt library, grouped by
 * purpose. The server component loads (and lazily seeds) the library; the
 * client browser handles grouping and filtering. Editing, versions, testing,
 * and audit live on each prompt's detail view.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import { listTenantPrompts } from "@/modules/prompt-versioning/server";
import { IntelligencePromptsBrowser } from "./intelligence-prompts-browser";

export default async function IntelligencePromptsPage() {
  const ctx = await requireTenantContext();
  const prompts = await listTenantPrompts(ctx);

  if (!prompts.ok) {
    return (
      <div className="alert alert--warn">
        <div>
          <p className="alert__body">
            The prompt library could not be loaded: {prompts.error.message}
          </p>
        </div>
      </div>
    );
  }

  return <IntelligencePromptsBrowser prompts={prompts.value} />;
}
