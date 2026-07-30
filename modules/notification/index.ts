/**
 * modules/notification — high-signal, low-noise nudges. Speaks only when not
 * speaking would be irresponsible. Governance: services/notification.md.
 *
 * In-app delivery is real (see ./server.ts: `notifications` table, deduped per
 * underlying event). Email delivery is real for the daily briefing (see
 * ./briefing-email.ts, SendGrid). `notifyBriefingReady` records one in-app cue
 * per briefing for the operator.
 */

import { ok, err, AppError, type Result, type TenantContext } from "@/modules/shared";
import { recordNotification } from "./server";

export interface NotificationService {
  notifyBriefingReady(ctx: TenantContext, briefingId: string): Promise<Result<void>>;
}

export const notificationService: NotificationService = {
  async notifyBriefingReady(ctx, briefingId) {
    if (!ctx.userId) return ok(undefined);
    try {
      await recordNotification({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        kind: "briefing_ready",
        title: "Your briefing is ready.",
        body: null,
        href: "/briefing",
        dedupeKey: briefingId,
      });
      return ok(undefined);
    } catch (cause) {
      return err(
        new AppError(
          "internal",
          cause instanceof Error ? cause.message : "notification_failed",
        ),
      );
    }
  },
};
