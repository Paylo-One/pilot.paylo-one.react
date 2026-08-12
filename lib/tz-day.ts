/**
 * lib/tz-day.ts
 *
 * Pure, dependency-free calendar-day reasoning in an operator's timezone.
 *
 * Vercel runs in UTC, but the Daily Memo's "good morning", "due today" and
 * "overdue" judgements have to match the calendar day the operator is actually
 * living in — not the server's. Getting this wrong shifts the whole triage by a
 * day near midnight and quietly breaks the trust contract of the wedge (an item
 * due tomorrow shown as "due today", or a morning briefing that says "good
 * evening"). Scheduling already does this correctly (lib/sync-schedule.ts); this
 * brings the read surface into line, using only native `Intl` APIs.
 */

interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
}

/**
 * Resolve the wall-clock parts of `date` in `timeZone`. Falls back to UTC if the
 * timezone is not recognised by the runtime (matching lib/sync-schedule.ts), so
 * a bad profile value degrades gracefully instead of throwing.
 */
function zonedParts(date: Date, timeZone: string): ZonedParts {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      hour12: false,
    });
  } catch {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      hour12: false,
    });
  }

  const parts = new Map(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: parseInt(parts.get("year")!, 10),
    month: parseInt(parts.get("month")!, 10),
    day: parseInt(parts.get("day")!, 10),
    // `hour12: false` can emit "24" for midnight in some runtimes; normalise.
    hour: parseInt(parts.get("hour")!, 10) % 24,
  };
}

/** The hour (0–23) of `date` as seen on the operator's wall clock. */
export function hourInTimeZone(date: Date, timeZone: string): number {
  return zonedParts(date, timeZone).hour;
}

/**
 * A comparable integer for the calendar day of `date` in `timeZone`, encoded as
 * `YYYYMMDD`. Monotonic, so two of these can be compared directly for
 * same-day (`===`), earlier-day (`<`) and later-day (`>`) without date maths.
 */
export function calendarDayInTimeZone(date: Date, timeZone: string): number {
  const { year, month, day } = zonedParts(date, timeZone);
  return year * 10000 + month * 100 + day;
}

/**
 * UTC instants that bound the operator's local calendar day.
 *
 * Timezone offsets are not constant (DST can make a local day 23 or 25 hours),
 * so derive both boundaries from the monotonic local-day value rather than
 * applying a fixed offset. The ±36 hour window covers every IANA timezone.
 */
export function calendarDayBoundsInTimeZone(
  date: Date,
  timeZone: string,
): { readonly start: Date; readonly end: Date } {
  const target = calendarDayInTimeZone(date, timeZone);
  const window = 36 * 60 * 60 * 1000;

  const firstInstantMatching = (matches: (day: number) => boolean): Date => {
    let low = date.getTime() - window;
    let high = date.getTime() + window;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (matches(calendarDayInTimeZone(new Date(middle), timeZone))) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    return new Date(low);
  };

  return {
    start: firstInstantMatching((day) => day >= target),
    end: firstInstantMatching((day) => day > target),
  };
}
