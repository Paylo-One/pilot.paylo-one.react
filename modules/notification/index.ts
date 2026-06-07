/**
 * modules/notification — high-signal, low-noise nudges (primarily the
 * briefing-ready cue). Speaks only when not speaking would be irresponsible.
 * Governance: services/notification.md.
 *
 * NOT THE FOCUS THIS PASS. This is a coherent typed stub: the interface is the
 * real intended shape, but there is no transactional email provider wired yet.
 * `notifyBriefingReady` simply records the intent to the server log and returns
 * success so callers (e.g. Briefing) can integrate against a stable contract.
 * Real delivery (in-app cue + provider email, preferences, rate limits) lands
 * in a later pass.
 */

import { ok, type Result, type TenantContext } from "@/modules/shared";

export interface NotificationService {
  notifyBriefingReady(ctx: TenantContext, briefingId: string): Promise<Result<void>>;
}

export const notificationService: NotificationService = {
  async notifyBriefingReady(ctx, briefingId) {
    // No-op placeholder: log the intent, deliver nothing. Calm by default.
    console.info(
      `[notification] briefing-ready (stub) tenant=${ctx.tenantId} briefing=${briefingId}`,
    );
    return ok(undefined);
  },
};
