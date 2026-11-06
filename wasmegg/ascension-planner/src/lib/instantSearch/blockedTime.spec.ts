import { describe, expect, it } from 'vitest';
import { getLocalTimestampInTimezone } from 'lib/planners/events';
import { avoidBlocked, hoursBlocked, localTime, nextDate, weekdayOf } from './blockedTime';
import { mergeBlocked, nextAllowed, type Blocked } from './routeFinder';

const CHI = 'America/Chicago';
const at = (date: string, time: string, tz = CHI) => localTime(date, time, tz);
const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);
/** Sleep 11 PM-7 AM every day. */
const SLEEP = range(0, 7).flatMap(d => [23, ...range(0, 7)].map(h => d * 24 + h));

describe('blocked time', () => {
  it('knows its dates', () => {
    expect(nextDate('2026-12-31')).toBe('2027-01-01');
    expect(weekdayOf('2026-10-19')).toBe(0); // a Monday
    expect(weekdayOf('2026-10-25')).toBe(6);
  });

  it('lays nightly sleep out as one span a night, in the zone picked', () => {
    const spans = hoursBlocked(SLEEP, CHI, at('2026-10-20', '12:00'), 10);
    // Tue 21 Oct 11 PM to Wed 7 AM, Chicago.
    expect(spans).toContainEqual([at('2026-10-20', '23:00'), at('2026-10-21', '07:00')]);
    for (const [a, b] of spans.slice(1, -1)) expect(b - a).toBe(8 * 3600);
  });

  it('converts local times right on the days the clocks change', () => {
    // Spring forward, 14 Mar 2027: 7:00 AM CDT is 12:00 UTC (lib/events.ts reads it as 13:00).
    expect(localTime('2027-03-14', '07:00', CHI)).toBe(Date.UTC(2027, 2, 14, 12) / 1000);
    // Fall back, 1 Nov 2026: 7:00 AM CST is 13:00 UTC.
    expect(localTime('2026-11-01', '07:00', CHI)).toBe(Date.UTC(2026, 10, 1, 13) / 1000);
    // Ordinary days agree with lib/events.ts.
    expect(localTime('2026-10-20', '07:00', CHI)).toBe(getLocalTimestampInTimezone('2026-10-20', '07:00', CHI));
  });

  it('follows the clocks across daylight saving', () => {
    const spans = hoursBlocked(SLEEP, CHI, at('2026-10-28', '12:00'), 160);
    // Fall back (1 Nov 2026): the night is an hour longer. Spring forward (14 Mar 2027): an hour shorter.
    expect(spans).toContainEqual([at('2026-10-31', '23:00'), at('2026-11-01', '07:00')]);
    expect(at('2026-11-01', '07:00') - at('2026-10-31', '23:00')).toBe(9 * 3600);
    expect(spans).toContainEqual([at('2027-03-13', '23:00'), at('2027-03-14', '07:00')]);
    expect(at('2027-03-14', '07:00') - at('2027-03-13', '23:00')).toBe(7 * 3600);
  });

  it('merges days to avoid with the hours', () => {
    const days = avoidBlocked(['2026-12-24', '2026-12-25'], CHI);
    expect(days).toEqual([[at('2026-12-24', '00:00'), at('2026-12-26', '00:00')]]);
    const all = mergeBlocked([...days, ...hoursBlocked(SLEEP, CHI, at('2026-12-20', '12:00'), 10)]);
    // The 23rd's night runs into the days, and the 26th's early hours on from them.
    expect(all).toContainEqual([at('2026-12-23', '23:00'), at('2026-12-26', '07:00')]);
  });

  it('finds the next allowed moment by halving, as a plain scan would', () => {
    const spans: Blocked = mergeBlocked(
      Array.from({ length: 400 }, (_, i) => [i * 1000 + (i % 7) * 50, i * 1000 + 300 + (i % 5) * 100] as [number, number])
    );
    const scan = (t: number) => {
      for (const [a, b] of spans) if (t >= a && t < b) return b;
      return t;
    };
    for (let t = -500; t < 401_000; t += 37) expect(nextAllowed(t, spans)).toBe(scan(t));
  });
});
