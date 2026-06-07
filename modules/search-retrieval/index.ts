/**
 * modules/search-retrieval — tenant-filtered hybrid (semantic + keyword)
 * retrieval that powers memos, actions, and the command palette. Always filters
 * by tenant_id. Governance: services/search-and-retrieval.md.
 * Scaffold note: interface only.
 */

import { NotImplementedError, type Result, type TenantContext } from "@/modules/shared";

export interface RetrievalHit {
  readonly itemId: string;
  readonly score: number;
}

export interface SearchRetrievalService {
  search(ctx: TenantContext, query: string, limit?: number): Promise<Result<RetrievalHit[]>>;
}

export const searchRetrievalService: SearchRetrievalService = {
  async search() {
    throw new NotImplementedError("search-retrieval.search");
  },
};
