/**
 * modules/briefing — assembles, ranks, and serves the source-referenced Daily
 * Memo on schedule and on demand. Governance: services/briefing.md,
 * product/daily-memo.md. Scaffold note: interface only.
 */

import { NotImplementedError, type Result, type TenantContext } from "@/modules/shared";

export interface Briefing {
  readonly id: string;
  readonly generatedAt: string;
}

export interface BriefingService {
  getLatest(ctx: TenantContext): Promise<Result<Briefing | null>>;
  requestGeneration(ctx: TenantContext): Promise<Result<{ jobId: string }>>;
}

export const briefingService: BriefingService = {
  async getLatest() {
    throw new NotImplementedError("briefing.getLatest");
  },
  async requestGeneration() {
    throw new NotImplementedError("briefing.requestGeneration");
  },
};
