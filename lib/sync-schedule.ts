/**
 * lib/sync-schedule.ts
 *
 * Pure, dependency-free scheduling math for source auto-refresh (ADR-043).
 * Extracted from the Inngest job module so it can be unit-tested without pulling
 * the server-only job graph. Uses only native Intl APIs — no date libraries.
 */

/**
 * Daylight-savings-safe next-sync timestamp for a connection, given its
 * frequency, the tenant owner's timezone, and preferred briefing time
 * ("HH:MM" / "HH:MM:SS"). The returned Date is always strictly after `baseDate`.
 *
 * Cadences anchor on the briefing time and split the day evenly:
 *  - daily              → once at the briefing time
 *  - twice_a_day        → +0h, +12h
 *  - three_times_a_day  → +0h, +8h, +16h
 *  - four_times_a_day   → +0h, +6h, +12h, +18h
 */
export function calculateNextSyncAt(
  frequency: string,
  timezone: string,
  briefingTimeStr: string,
  baseDate: Date = new Date(),
): Date {
  const briefingTime = briefingTimeStr || "08:00:00";
  const timeParts = briefingTime.split(":");
  const hours = Number.isFinite(Number(timeParts[0])) ? Number(timeParts[0]) : 8;
  const minutes = Number.isFinite(Number(timeParts[1])) ? Number(timeParts[1]) : 0;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    });
  } catch {
    timezone = "UTC";
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    });
  }

  const parts = formatter.formatToParts(baseDate);
  const partMap = new Map(parts.map((p) => [p.type, p.value]));

  const year = parseInt(partMap.get("year")!, 10);
  const month = parseInt(partMap.get("month")!, 10);
  const day = parseInt(partMap.get("day")!, 10);

  const constructInTimezone = (y: number, m: number, d: number, hr: number, min: number): Date => {
    const tentativeUtc = Date.UTC(y, m - 1, d, hr, min, 0);
    let candidate = new Date(tentativeUtc);

    for (let i = 0; i < 3; i++) {
      const cparts = formatter.formatToParts(candidate);
      const pm = new Map(cparts.map((p) => [p.type, p.value]));
      const cy = parseInt(pm.get("year")!, 10);
      const cm = parseInt(pm.get("month")!, 10);
      const cd = parseInt(pm.get("day")!, 10);
      const ch = parseInt(pm.get("hour")!, 10) % 24;
      const cmin = parseInt(pm.get("minute")!, 10);

      const targetUtc = Date.UTC(y, m - 1, d, hr, min, 0);
      const currentUtc = Date.UTC(cy, cm - 1, cd, ch, cmin, 0);
      const diff = targetUtc - currentUtc;

      if (diff === 0) break;
      candidate = new Date(candidate.getTime() + diff);
    }
    return candidate;
  };

  const target = constructInTimezone(year, month, day, hours, minutes);

  const intervals: number[] = [];
  if (frequency === "twice_a_day") {
    intervals.push(12);
  } else if (frequency === "three_times_a_day") {
    intervals.push(8, 16);
  } else if (frequency === "four_times_a_day") {
    intervals.push(6, 12, 18);
  }

  const candidateDates: Date[] = [target];
  for (const offsetHours of intervals) {
    const offsetHr = (hours + offsetHours) % 24;
    const dayOffset = Math.floor((hours + offsetHours) / 24);
    candidateDates.push(constructInTimezone(year, month, day + dayOffset, offsetHr, minutes));
  }

  const tomorrowCandidates = candidateDates.map((d) => new Date(d.getTime() + 24 * 60 * 60 * 1000));
  const allCandidates = [...candidateDates, ...tomorrowCandidates];

  allCandidates.sort((a, b) => a.getTime() - b.getTime());
  const nextSync = allCandidates.find((d) => d.getTime() > baseDate.getTime());

  return nextSync || new Date(baseDate.getTime() + 24 * 60 * 60 * 1000);
}
