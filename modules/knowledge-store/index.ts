/**
 * modules/knowledge-store — the canonical, queryable store of normalised items,
 * summaries, and embeddings (pgvector), governed by retention policy.
 * Governance: services/knowledge-store.md. Scaffold note: interface only.
 */

import { NotImplementedError, type Result, type TenantContext } from "@/modules/shared";

export interface KnowledgeStoreService {
  getItem(ctx: TenantContext, itemId: string): Promise<Result<{ itemId: string } | null>>;
}

export const knowledgeStoreService: KnowledgeStoreService = {
  async getItem() {
    throw new NotImplementedError("knowledge-store.getItem");
  },
};
