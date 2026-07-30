/**
 * Actions — the execution-memory surface, presented as a Kanban board.
 *
 * Five workflow columns over the action statuses (review, planned, in
 * progress, waiting, done), drag-and-drop plus an accessible move menu, quick
 * capture without leaving the page, and a duplicate review strip fed by the
 * generation-time semantic dedupe flags.
 */

import { requireTenantContext } from "@/modules/identity-tenant/server";
import { listSuggestedActions } from "@/modules/action-extraction/server";
import { listPeopleDirectory } from "@/modules/people/people-server";
import { ActionsWorkspace } from "./actions-workspace";

export default async function ActionsPage() {
  const ctx = await requireTenantContext();
  const [actions, people] = await Promise.all([
    listSuggestedActions(ctx.tenantId),
    listPeopleDirectory(),
  ]);

  return (
    <main className="workspace__content actions-page">
      <ActionsWorkspace
        actions={actions}
        people={people.map((person) => ({
          id: person.id,
          displayName: person.displayName,
          roleTitle: person.roleTitle,
          organisation: person.organisation,
          status: person.status,
        }))}
      />
    </main>
  );
}
