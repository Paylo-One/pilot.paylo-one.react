/**
 * modules/action-extraction — detects candidate actions from context and runs
 * the approve/edit/defer/dismiss lifecycle. No autonomous external actions.
 * Governance: services/action-extraction.md, product/actions.md.
 * Scaffold note: interface only.
 */

import { NotImplementedError, type Result, type TenantContext } from "@/modules/shared";

export type ActionStatus = "suggested" | "approved" | "edited" | "deferred" | "dismissed";

export interface SuggestedAction {
  readonly id: string;
  readonly status: ActionStatus;
}

export interface ActionExtractionService {
  listSuggested(ctx: TenantContext): Promise<Result<SuggestedAction[]>>;
}

export const actionExtractionService: ActionExtractionService = {
  async listSuggested() {
    throw new NotImplementedError("action-extraction.listSuggested");
  },
};
