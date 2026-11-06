/**
 * Chain Finder's filters as the finder reads them: unix-second spans no prestige may start in
 * (routeFinder.ts `FindOptions.avoid`). Days to avoid and weekly blocked hours are both read in the
 * time zone the user picked, daylight saving included.
 */
import { getLocalTimestampInTimezone, getTimezoneOffsetAt } from 'lib/planners/events';
import { formatUnixToDateInput } from '@/lib/format';
import { mergeBlocked, type Blocked } from './routeFinder';

/**
 * A local date and time in `tz` as a unix second, right on the days the clocks change.
 * `getLocalTimestampInTimezone` (lib/events.ts) takes the zone's offset at the wrong instant, so a
 * time in the hours just after a change comes out an hour off (7:00 AM on spring-forward morning reads
 * as 8:00 AM). Midnights are unaffected, the changes being at 2 AM. This takes the offset again at the
 * instant found, which settles it. A time the clocks skip lands an hour later.
 */
export function localTime(date: string, time: string, tz: string): number {
  const first = getLocalTimestampInTimezone(date, time, tz);
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min) / 1000;
  return wall - getTimezoneOffsetAt(tz, first);
}

/** Hours in a week: blocked hours are indices 0-167, Monday 00:00-01:00 first. */
export const WEEK_HOURS = 168;

/** How far ahead weekly hours are laid out. A route to 490 from low in the game can take years;
 *  past this its prestiges are not held. */
export const HOURS_HORIZON_DAYS = 5 * 366;

/** The day after a YYYY-MM-DD date. */
export function nextDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** A YYYY-MM-DD date's weekday, Monday 0 to Sunday 6. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Days (YYYY-MM-DD) as merged spans, each from its midnight to the next in `tz`. */
export function avoidBlocked(dates: string[], tz: string): Blocked {
  return mergeBlocked(
    dates.map(d => [getLocalTimestampInTimezone(d, '00:00', tz), getLocalTimestampInTimezone(nextDate(d), '00:00', tz)])
  );
}

/**
 * Weekly blocked hours (indices into the week, `WEEK_HOURS`) as merged spans in `tz`, for every day
 * from the one before `from` to `days` after it. On the two days a year the clocks change, each hour
 * is placed by the clock (so the 2 AM hour that doesn't exist blocks nothing).
 */
export function hoursBlocked(hours: number[], tz: string, from: number, days = HOURS_HORIZON_DAYS): Blocked {
  if (!hours.length) return [];
  const byDay = Array.from({ length: 7 }, () => [] as number[]);
  for (const i of hours) if (i >= 0 && i < WEEK_HOURS) byDay[Math.floor(i / 24)].push(i % 24);
  const spans: Blocked = [];
  let date = formatUnixToDateInput(from - 86400, tz);
  let dayStart = getLocalTimestampInTimezone(date, '00:00', tz);
  for (let n = 0; n <= days + 1; n++) {
    const next = nextDate(date);
    const nextStart = getLocalTimestampInTimezone(next, '00:00', tz);
    const plain = nextStart - dayStart === 86400;
    for (const h of byDay[weekdayOf(date)]) {
      const a = plain ? dayStart + h * 3600 : localTime(date, `${String(h).padStart(2, '0')}:00`, tz);
      const b = h === 23 ? nextStart : plain ? a + 3600 : localTime(date, `${String(h + 1).padStart(2, '0')}:00`, tz);
      if (b > a) spans.push([a, b]);
    }
    date = next;
    dayStart = nextStart;
  }
  return mergeBlocked(spans);
}
