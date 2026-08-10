import "server-only";

/**
 * modules/notification/briefing-email.ts
 *
 * The daily briefing email: one concise, scannable summary of the operator's
 * actions, sent at their preferred briefing time in their own timezone.
 *
 * Idempotency is layered: the Inngest event is deduped by
 * `tenant:user:localDay`, and the sender claims a row in
 * `notification_deliveries` (unique on the same key) BEFORE calling the
 * provider. A repeat invocation finds the claim and stops, so a briefing can
 * never be delivered twice for the same local calendar day.
 *
 * An empty day sends nothing (recorded as `skipped_empty`), and a user who
 * turned the email off (settings toggle or the unsubscribe link) is never
 * queued. Selection and rendering are pure functions, exported for tests.
 */

import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import {
  sendgridApiKey,
  sendgridConfigured,
  sendgridFromEmail,
  tenantBaseUrl,
  appHostBaseUrl,
} from "@/lib/config";
import { calendarDayInTimeZone } from "@/lib/tz-day";
import { recordNotification } from "./server";

const OPEN_STATUSES = ["inbox", "planned", "in_progress", "waiting", "follow_up"] as const;
const SECTION_LIMIT = 6;

export interface BriefingActionItem {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly priority: string;
  readonly dueAt: string | null;
  readonly followUpAt: string | null;
}

export interface BriefingDigest {
  readonly overdue: BriefingActionItem[];
  readonly dueToday: BriefingActionItem[];
  readonly upcoming: BriefingActionItem[];
  readonly reminders: BriefingActionItem[];
  readonly awaitingReview: BriefingActionItem[];
  readonly isEmpty: boolean;
}

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

function byUrgency(a: BriefingActionItem, b: BriefingActionItem): number {
  const aDue = a.dueAt ?? a.followUpAt ?? "9999";
  const bDue = b.dueAt ?? b.followUpAt ?? "9999";
  if (aDue !== bDue) return aDue < bDue ? -1 : 1;
  return (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2);
}

/**
 * Bucket open actions into the briefing's sections using the operator's
 * calendar day. Pure; exported for tests. Each action appears in exactly one
 * section (overdue wins over due-today wins over upcoming; reminders and
 * review items are separate lanes).
 */
export function buildBriefingDigest(
  actions: readonly BriefingActionItem[],
  timezone: string,
  now: Date = new Date(),
): BriefingDigest {
  const today = calendarDayInTimeZone(now, timezone);
  const horizon = calendarDayInTimeZone(
    new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    timezone,
  );

  const overdue: BriefingActionItem[] = [];
  const dueToday: BriefingActionItem[] = [];
  const upcoming: BriefingActionItem[] = [];
  const reminders: BriefingActionItem[] = [];
  const awaitingReview: BriefingActionItem[] = [];

  for (const action of actions) {
    if (action.status === "inbox") {
      awaitingReview.push(action);
      continue;
    }
    const dueDay = action.dueAt
      ? calendarDayInTimeZone(new Date(action.dueAt), timezone)
      : null;
    if (dueDay !== null && dueDay < today) {
      overdue.push(action);
      continue;
    }
    if (dueDay !== null && dueDay === today) {
      dueToday.push(action);
      continue;
    }
    if (dueDay !== null && dueDay <= horizon) {
      upcoming.push(action);
      continue;
    }
    const followDay = action.followUpAt
      ? calendarDayInTimeZone(new Date(action.followUpAt), timezone)
      : null;
    if (followDay !== null && followDay <= today) {
      reminders.push(action);
    }
  }

  for (const bucket of [overdue, dueToday, upcoming, reminders, awaitingReview]) {
    bucket.sort(byUrgency);
  }

  return {
    overdue,
    dueToday,
    upcoming,
    reminders,
    awaitingReview,
    isEmpty:
      overdue.length === 0 &&
      dueToday.length === 0 &&
      upcoming.length === 0 &&
      reminders.length === 0 &&
      awaitingReview.length === 0,
  };
}

/** "tenant:user:YYYYMMDD" in the operator's timezone. Pure; exported for tests. */
export function dailyBriefingDedupeKey(
  tenantId: string,
  userId: string,
  timezone: string,
  now: Date = new Date(),
): string {
  return `${tenantId}:${userId}:${calendarDayInTimeZone(now, timezone)}`;
}

/** Wall-clock minutes since local midnight, DST-safe via Intl. */
export function minutesOfDayInTimeZone(date: Date, timeZone: string): number {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
  } catch {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
  }
  const parts = new Map(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = parseInt(parts.get("hour") ?? "0", 10) % 24;
  const minute = parseInt(parts.get("minute") ?? "0", 10);
  return hour * 60 + minute;
}

/** "HH:MM[:SS]" -> minutes since midnight; malformed input falls back to 08:00. */
export function parseBriefingTime(value: string | null | undefined): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? "");
  if (!match) return 8 * 60;
  const hours = Math.min(23, parseInt(match[1]!, 10));
  const minutes = Math.min(59, parseInt(match[2]!, 10));
  return hours * 60 + minutes;
}

/** True when the operator's briefing time has passed on their wall clock. */
export function isBriefingDue(
  now: Date,
  timezone: string,
  briefingTime: string | null | undefined,
): boolean {
  return minutesOfDayInTimeZone(now, timezone) >= parseBriefingTime(briefingTime);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDay(value: string | null, timezone: string): string {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      day: "numeric",
      month: "short",
    }).format(new Date(value));
  } catch {
    return value.slice(0, 10);
  }
}

interface RenderInput {
  readonly digest: BriefingDigest;
  readonly timezone: string;
  readonly dateLabel: string;
  readonly actionsUrl: string;
  readonly actionUrl: (id: string) => string;
  readonly unsubscribeUrl: string;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** One-line summary used for the subject. Pure; exported for tests. */
export function briefingSubject(digest: BriefingDigest): string {
  const parts: string[] = [];
  if (digest.overdue.length > 0) parts.push(`${digest.overdue.length} overdue`);
  if (digest.dueToday.length > 0) parts.push(`${digest.dueToday.length} due today`);
  if (digest.awaitingReview.length > 0) parts.push(`${digest.awaitingReview.length} to review`);
  if (parts.length === 0 && digest.reminders.length > 0) {
    parts.push(`${digest.reminders.length} reminder${digest.reminders.length === 1 ? "" : "s"}`);
  }
  if (parts.length === 0 && digest.upcoming.length > 0) {
    parts.push(`${digest.upcoming.length} coming up`);
  }
  return parts.length > 0 ? `Daily briefing: ${parts.join(", ")}` : "Daily briefing";
}

function sectionHtml(
  title: string,
  items: readonly BriefingActionItem[],
  input: RenderInput,
  dateField: "dueAt" | "followUpAt",
): string {
  if (items.length === 0) return "";
  const rows = items
    .slice(0, SECTION_LIMIT)
    .map((item) => {
      const day = formatDay(item[dateField], input.timezone);
      return `<tr>
        <td style="padding:6px 0;border-bottom:1px solid #e3e5ea;">
          <a href="${input.actionUrl(item.id)}" style="color:#16181d;text-decoration:none;font-size:15px;line-height:1.4;">${escapeHtml(item.title)}</a>
          ${day ? `<span style="color:#878d98;font-size:13px;">&nbsp;&nbsp;${escapeHtml(day)}</span>` : ""}
        </td>
      </tr>`;
    })
    .join("");
  const more =
    items.length > SECTION_LIMIT
      ? `<tr><td style="padding:6px 0;color:#878d98;font-size:13px;">and ${items.length - SECTION_LIMIT} more in Pilot</td></tr>`
      : "";
  return `<tr><td style="padding:20px 0 4px;">
      <p style="margin:0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#565d68;font-weight:600;">${escapeHtml(title)}</p>
    </td></tr>
    <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}${more}</table></td></tr>`;
}

function sectionText(
  title: string,
  items: readonly BriefingActionItem[],
  input: RenderInput,
  dateField: "dueAt" | "followUpAt",
): string {
  if (items.length === 0) return "";
  const lines = items
    .slice(0, SECTION_LIMIT)
    .map((item) => {
      const day = formatDay(item[dateField], input.timezone);
      return `- ${item.title}${day ? ` (${day})` : ""}\n  ${input.actionUrl(item.id)}`;
    })
    .join("\n");
  const more =
    items.length > SECTION_LIMIT
      ? `\n  and ${items.length - SECTION_LIMIT} more in Pilot`
      : "";
  return `${title.toUpperCase()}\n${lines}${more}\n\n`;
}

/** Render the full email. Pure; exported for tests. */
export function renderDailyBriefingEmail(input: RenderInput): RenderedEmail {
  const { digest } = input;
  const subject = briefingSubject(digest);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:'IBM Plex Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#16181d;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e3e5ea;border-radius:8px;">
        <tr><td style="padding:28px 32px 0;">
          <p style="margin:0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#157a86;font-weight:600;">Pilot</p>
          <h1 style="margin:8px 0 0;font-size:20px;font-weight:600;line-height:1.3;">Your daily briefing</h1>
          <p style="margin:6px 0 0;color:#565d68;font-size:14px;">${escapeHtml(input.dateLabel)}</p>
        </td></tr>
        <tr><td style="padding:8px 32px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${sectionHtml("Overdue", digest.overdue, input, "dueAt")}
            ${sectionHtml("Due today", digest.dueToday, input, "dueAt")}
            ${sectionHtml("Awaiting your review", digest.awaitingReview, input, "dueAt")}
            ${sectionHtml("Reminders", digest.reminders, input, "followUpAt")}
            ${sectionHtml("Coming up this week", digest.upcoming, input, "dueAt")}
          </table>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
            <tr><td style="background:#157a86;border-radius:4px;">
              <a href="${input.actionsUrl}" style="display:inline-block;padding:10px 18px;color:#ffffff;font-size:14px;font-weight:500;text-decoration:none;">Open your actions</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:16px 32px 24px;border-top:1px solid #e3e5ea;">
          <p style="margin:0;color:#878d98;font-size:12px;line-height:1.6;">
            You receive this briefing each morning because it is turned on in your Pilot settings.
            <a href="${input.unsubscribeUrl}" style="color:#565d68;">Stop these emails</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text =
    `PILOT DAILY BRIEFING\n${input.dateLabel}\n\n` +
    sectionText("Overdue", digest.overdue, input, "dueAt") +
    sectionText("Due today", digest.dueToday, input, "dueAt") +
    sectionText("Awaiting your review", digest.awaitingReview, input, "dueAt") +
    sectionText("Reminders", digest.reminders, input, "followUpAt") +
    sectionText("Coming up this week", digest.upcoming, input, "dueAt") +
    `Open your actions: ${input.actionsUrl}\n\nStop these emails: ${input.unsubscribeUrl}\n`;

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

async function sendViaSendGrid(input: {
  readonly to: string;
  readonly email: RenderedEmail;
  readonly unsubscribeUrl: string;
}): Promise<void> {
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sendgridApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: input.to }] }],
      from: { email: sendgridFromEmail(), name: "Pilot" },
      subject: input.email.subject,
      content: [
        { type: "text/plain", value: input.email.text },
        { type: "text/html", value: input.email.html },
      ],
      headers: {
        "List-Unsubscribe": `<${input.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      mail_settings: { sandbox_mode: { enable: false } },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`SendGrid ${response.status}: ${detail.slice(0, 300)}`);
  }
}

export interface DailyBriefingDeliveryResult {
  readonly outcome:
    | "sent"
    | "skipped_empty"
    | "skipped_duplicate"
    | "skipped_disabled"
    | "skipped_unconfigured"
    | "failed";
  readonly detail?: string;
}

/**
 * Deliver one tenant owner's daily briefing for their current local day.
 * Safe to call repeatedly: the delivery-log claim makes it idempotent.
 */
export async function runDailyBriefingDelivery(input: {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly userId: string;
  readonly timezone: string;
  readonly now?: Date;
}): Promise<DailyBriefingDeliveryResult> {
  const secret = createSupabaseSecretClient();
  const now = input.now ?? new Date();

  // Preference gate: profile toggle off (or unsubscribed) means never queue.
  const { data: profile } = await secret
    .from("user_profiles")
    .select("daily_briefing_email, unsubscribe_token")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (!profile || profile.daily_briefing_email === false) {
    return { outcome: "skipped_disabled" };
  }

  const { data: authUser } = await secret.auth.admin.getUserById(input.userId);
  const toEmail = authUser?.user?.email;
  if (!toEmail) return { outcome: "skipped_disabled", detail: "no email on record" };

  const dedupeKey = dailyBriefingDedupeKey(
    input.tenantId,
    input.userId,
    input.timezone,
    now,
  );

  // Claim before send. A conflict means today's briefing was already handled.
  const { data: claim, error: claimError } = await secret
    .from("notification_deliveries")
    .upsert(
      {
        tenant_id: input.tenantId,
        user_id: input.userId,
        kind: "daily_briefing",
        dedupe_key: dedupeKey,
        status: "sending",
      },
      { onConflict: "tenant_id,user_id,kind,dedupe_key", ignoreDuplicates: true },
    )
    .select("dedupe_key");
  if (claimError) return { outcome: "failed", detail: claimError.message };
  if ((claim ?? []).length === 0) return { outcome: "skipped_duplicate" };

  async function finalise(status: string, error?: string, summary?: unknown) {
    await secret
      .from("notification_deliveries")
      .update({
        status,
        error: error ?? null,
        summary: summary ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("tenant_id", input.tenantId)
      .eq("user_id", input.userId)
      .eq("kind", "daily_briefing")
      .eq("dedupe_key", dedupeKey);
  }

  // Select the day's actions.
  const { data: rows, error: actionsError } = await secret
    .from("suggested_actions")
    .select("id, title, status, priority, due_at, follow_up_at")
    .eq("tenant_id", input.tenantId)
    .in("status", [...OPEN_STATUSES])
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(200);
  if (actionsError) {
    await finalise("failed", actionsError.message);
    return { outcome: "failed", detail: actionsError.message };
  }

  const digest = buildBriefingDigest(
    ((rows ?? []) as {
      id: string;
      title: string;
      status: string;
      priority: string;
      due_at: string | null;
      follow_up_at: string | null;
    }[]).map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      dueAt: row.due_at,
      followUpAt: row.follow_up_at,
    })),
    input.timezone,
    now,
  );

  if (digest.isEmpty) {
    await finalise("skipped_empty");
    return { outcome: "skipped_empty" };
  }

  // Quiet in-app cue for overdue work, once per local day (its own dedupe key).
  if (digest.overdue.length > 0) {
    try {
      await recordNotification({
        tenantId: input.tenantId,
        userId: input.userId,
        kind: "actions_overdue",
        title:
          digest.overdue.length === 1
            ? "1 action is overdue."
            : `${digest.overdue.length} actions are overdue.`,
        href: "/actions",
        dedupeKey,
      });
    } catch {
      // The email is the deliverable; a nudge failure never blocks it.
    }
  }

  if (!sendgridConfigured()) {
    await finalise("skipped_unconfigured", "SENDGRID_API_KEY not configured");
    return { outcome: "skipped_unconfigured" };
  }

  const baseUrl = tenantBaseUrl(input.tenantSlug);
  const unsubscribeUrl = `${appHostBaseUrl()}/api/notifications/unsubscribe?token=${profile.unsubscribe_token}`;
  let dateLabel: string;
  try {
    dateLabel = new Intl.DateTimeFormat("en-GB", {
      timeZone: input.timezone,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(now);
  } catch {
    dateLabel = now.toISOString().slice(0, 10);
  }

  const email = renderDailyBriefingEmail({
    digest,
    timezone: input.timezone,
    dateLabel,
    actionsUrl: `${baseUrl}/actions`,
    actionUrl: (id) => `${baseUrl}/actions/${id}`,
    unsubscribeUrl,
  });

  try {
    await sendViaSendGrid({ to: toEmail, email, unsubscribeUrl });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "send failed";
    await finalise("failed", message);
    return { outcome: "failed", detail: message };
  }

  await finalise("sent", undefined, {
    overdue: digest.overdue.length,
    dueToday: digest.dueToday.length,
    upcoming: digest.upcoming.length,
    reminders: digest.reminders.length,
    awaitingReview: digest.awaitingReview.length,
  });
  return { outcome: "sent" };
}
