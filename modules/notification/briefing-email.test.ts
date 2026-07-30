import { describe, expect, it } from "vitest";
import {
  briefingSubject,
  buildBriefingDigest,
  dailyBriefingDedupeKey,
  isBriefingDue,
  minutesOfDayInTimeZone,
  parseBriefingTime,
  renderDailyBriefingEmail,
  type BriefingActionItem,
} from "./briefing-email";

let seq = 0;
function item(overrides: Partial<BriefingActionItem> = {}): BriefingActionItem {
  seq += 1;
  return {
    id: `item-${seq}`,
    title: `Item ${seq}`,
    status: "planned",
    priority: "normal",
    dueAt: null,
    followUpAt: null,
    ...overrides,
  };
}

// Noon UTC on 30 July 2026: still 30 July in Amsterdam and New York.
const NOW = new Date("2026-07-30T12:00:00Z");
const TZ = "Europe/Amsterdam";

describe("buildBriefingDigest", () => {
  it("buckets by the operator's calendar day, each action exactly once", () => {
    const digest = buildBriefingDigest(
      [
        item({ id: "over", dueAt: "2026-07-28T10:00:00Z" }),
        item({ id: "today", dueAt: "2026-07-30T15:00:00Z" }),
        item({ id: "soon", dueAt: "2026-08-03T10:00:00Z" }),
        item({ id: "far", dueAt: "2026-09-20T10:00:00Z" }),
        item({ id: "remind", followUpAt: "2026-07-29T10:00:00Z" }),
        item({ id: "review", status: "inbox" }),
      ],
      TZ,
      NOW,
    );
    expect(digest.overdue.map((x) => x.id)).toEqual(["over"]);
    expect(digest.dueToday.map((x) => x.id)).toEqual(["today"]);
    expect(digest.upcoming.map((x) => x.id)).toEqual(["soon"]);
    expect(digest.reminders.map((x) => x.id)).toEqual(["remind"]);
    expect(digest.awaitingReview.map((x) => x.id)).toEqual(["review"]);
    expect(digest.isEmpty).toBe(false);
    // "far" is beyond the 7-day horizon and has no reminder: excluded.
    const all = [
      ...digest.overdue,
      ...digest.dueToday,
      ...digest.upcoming,
      ...digest.reminders,
      ...digest.awaitingReview,
    ].map((x) => x.id);
    expect(all).not.toContain("far");
    expect(new Set(all).size).toBe(all.length);
  });

  it("respects the timezone boundary near midnight", () => {
    // 23:30 UTC on 30 July is already 31 July in Amsterdam.
    const lateNow = new Date("2026-07-30T23:30:00Z");
    const digest = buildBriefingDigest(
      [item({ id: "d", dueAt: "2026-07-30T10:00:00Z" })],
      TZ,
      lateNow,
    );
    expect(digest.overdue.map((x) => x.id)).toEqual(["d"]);
    expect(digest.dueToday).toHaveLength(0);
  });

  it("reports an empty day so no email is sent", () => {
    const digest = buildBriefingDigest([item({ id: "far", dueAt: "2026-10-01T00:00:00Z" })], TZ, NOW);
    expect(digest.isEmpty).toBe(true);
  });
});

describe("scheduling helpers", () => {
  it("dedupe key pins one briefing per user per local day", () => {
    const a = dailyBriefingDedupeKey("t1", "u1", TZ, NOW);
    const b = dailyBriefingDedupeKey("t1", "u1", TZ, new Date("2026-07-30T18:00:00Z"));
    const c = dailyBriefingDedupeKey("t1", "u1", TZ, new Date("2026-07-31T06:00:00Z"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toContain("t1");
    expect(a).toContain("u1");
  });

  it("dedupe key follows the operator's day, not the server's", () => {
    // 23:30 UTC on 30 July: 31 July in Amsterdam, 30 July in UTC.
    const late = new Date("2026-07-30T23:30:00Z");
    expect(dailyBriefingDedupeKey("t", "u", TZ, late)).toContain("20260731");
    expect(dailyBriefingDedupeKey("t", "u", "UTC", late)).toContain("20260730");
  });

  it("parses briefing times and falls back calmly", () => {
    expect(parseBriefingTime("08:00:00")).toBe(480);
    expect(parseBriefingTime("07:30")).toBe(450);
    expect(parseBriefingTime(null)).toBe(480);
    expect(parseBriefingTime("nonsense")).toBe(480);
  });

  it("marks the briefing due only after the local time passes", () => {
    // 05:00 UTC = 07:00 in Amsterdam (CEST): 07:30 briefing not yet due.
    expect(isBriefingDue(new Date("2026-07-30T05:00:00Z"), TZ, "07:30:00")).toBe(false);
    // 06:00 UTC = 08:00 in Amsterdam: due.
    expect(isBriefingDue(new Date("2026-07-30T06:00:00Z"), TZ, "07:30:00")).toBe(true);
  });

  it("reads wall-clock minutes in a timezone", () => {
    expect(minutesOfDayInTimeZone(new Date("2026-07-30T06:15:00Z"), "UTC")).toBe(375);
    expect(minutesOfDayInTimeZone(new Date("2026-07-30T06:15:00Z"), TZ)).toBe(495);
  });
});

describe("rendering", () => {
  const digest = buildBriefingDigest(
    [
      item({ id: "over-1", title: "Chase the unpaid invoice", dueAt: "2026-07-28T10:00:00Z" }),
      item({ id: "rev-1", title: "Approve supplier shortlist", status: "inbox" }),
    ],
    TZ,
    NOW,
  );

  const rendered = renderDailyBriefingEmail({
    digest,
    timezone: TZ,
    dateLabel: "Thursday 30 July",
    actionsUrl: "https://acme.paylo.one/actions",
    actionUrl: (id) => `https://acme.paylo.one/actions/${id}`,
    unsubscribeUrl: "https://app.paylo.one/api/notifications/unsubscribe?token=tok",
  });

  it("summarises the day in the subject without alarm", () => {
    expect(rendered.subject).toBe("Daily briefing: 1 overdue, 1 to review");
    expect(briefingSubject(buildBriefingDigest([], TZ, NOW))).toBe("Daily briefing");
  });

  it("links every listed action back to the platform", () => {
    expect(rendered.html).toContain("https://acme.paylo.one/actions/over-1");
    expect(rendered.html).toContain("https://acme.paylo.one/actions/rev-1");
    expect(rendered.html).toContain("https://acme.paylo.one/actions");
    expect(rendered.text).toContain("https://acme.paylo.one/actions/over-1");
  });

  it("always carries the unsubscribe link", () => {
    expect(rendered.html).toContain("unsubscribe?token=tok");
    expect(rendered.text).toContain("unsubscribe?token=tok");
  });

  it("escapes HTML in action titles", () => {
    const hostile = renderDailyBriefingEmail({
      digest: buildBriefingDigest(
        [item({ title: '<img src=x onerror=alert(1)> & "quotes"', dueAt: "2026-07-30T15:00:00Z" })],
        TZ,
        NOW,
      ),
      timezone: TZ,
      dateLabel: "Thursday 30 July",
      actionsUrl: "https://acme.paylo.one/actions",
      actionUrl: (id) => `https://acme.paylo.one/actions/${id}`,
      unsubscribeUrl: "https://app.paylo.one/u",
    });
    expect(hostile.html).not.toContain("<img src=x");
    expect(hostile.html).toContain("&lt;img");
  });
});
