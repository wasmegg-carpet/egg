/**
 * Chain comparison's chain space on the deployed maxed table (public/instant/table.bin.gz).
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { getLocalTimestampInTimezone, PACIFIC_TIMEZONE } from 'lib/planners/events';
import { chainPricer, findRoutes, polishFound, type FindOptions, type Route } from './routeFinder';
import {
  chainGaps,
  createLegHours,
  enumerateChains,
  fillLegHours,
  filterSpace,
  type ChainSpace,
  type LegHours,
} from './chainSpace';
import { hoursBlocked } from './blockedTime';
import { readTable } from './table';

const gz = readFileSync(new URL('../../../public/instant/table.bin.gz', import.meta.url));
const bytes = gunzipSync(gz);
const table = readTable(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const pt = (date: string, time: string) => getLocalTimestampInTimezone(date, time, PACIFIC_TIMEZONE);
const DAY = 86400;

const start = pt('2026-10-22', '01:30');
const o: FindOptions = { startTE: 226, start, final: 490, maxAscensions: 12 };
let legHours: LegHours;
let routes: (Route | null)[];

beforeAll(() => {
  // From just below the start TE: the bound lets anything through below what it covers.
  legHours = createLegHours(220, table.header.to, 490);
  while (fillLegHours(legHours, table.lookup));
  routes = polishFound(table.lookup, o, findRoutes(table.lookup, o)).byAscensions;
}, 120_000);

const chainsOf = (s: ChainSpace, idx?: number[]) =>
  (idx ?? Array.from({ length: s.count }, (_, i) => i)).map(c =>
    Array.from(s.stops.subarray(c * s.legs, (c + 1) * s.legs)).join(',')
  );

describe('chain space', () => {
  it('finds every chain a walk without the bound finds, priced as the finder prices them', () => {
    const route = routes[3]!;
    const limit = route.end + 4 * DAY;
    const fast = enumerateChains(table.lookup, legHours, o, route, limit);
    const slow = enumerateChains(table.lookup, legHours, o, route, limit, { margin: Infinity });
    expect(fast.count).toBeGreaterThan(20);
    expect(fast.walked).toBeLessThan(slow.walked / 10);
    expect(chainsOf(fast).sort()).toEqual(chainsOf(slow).sort());
    // Soonest first, the route itself among them, each end the chain pricer's.
    for (let i = 1; i < fast.count; i++) expect(fast.ends[i]).toBeGreaterThanOrEqual(fast.ends[i - 1]);
    expect(chainsOf(fast)).toContain(route.chain.join(','));
    const pricer = chainPricer(table.lookup, o, false);
    for (let c = 0; c < fast.count; c += 5) {
      const chain = Array.from(fast.stops.subarray(c * 3, c * 3 + 3));
      expect(pricer.price(chain)!.end).toBe(fast.ends[c]);
    }
  });

  it('cuts by TE between prestiges and day windows as filtering afterwards would', () => {
    const route = routes[5]!;
    const gaps = chainGaps(route.chain, o.startTE);
    const minGap = Math.min(...gaps);
    const maxGap = Math.max(...gaps);
    const limit = route.end + 2 * DAY;
    const third = route.legs[2].start;
    const windows: [number, number][] = [[third - 2 * DAY, third + 2 * DAY]];
    const wide = enumerateChains(table.lookup, legHours, o, route, limit);
    const narrow = enumerateChains(table.lookup, legHours, o, route, limit, { minGap, maxGap, windows });
    expect(narrow.count).toBeGreaterThan(0);
    expect(narrow.count).toBeLessThan(wide.count);
    expect(chainsOf(narrow)).toEqual(chainsOf(wide, filterSpace(wide, o.startTE, { limit, minGap, maxGap, windows })));
    for (let c = 0; c < narrow.count; c++) {
      const stops = narrow.stops.subarray(c * 5, c * 5 + 5);
      for (const g of chainGaps(stops, o.startTE)) expect(g >= minGap && g <= maxGap).toBe(true);
      const prestiges = Array.from(narrow.prestiges.subarray(c * 5, c * 5 + 5));
      expect(prestiges.some(t => t >= windows[0][0] && t < windows[0][1])).toBe(true);
    }
  }, 60_000);

  it('holds prestiges out of blocked hours, as the search does', () => {
    const sleep = [0, 1, 2, 3, 4, 5, 6].flatMap(d => [23, 0, 1, 2, 3, 4, 5, 6].map(h => d * 24 + h));
    const avoid = hoursBlocked(sleep, PACIFIC_TIMEZONE, start);
    const blocked = { ...o, avoid };
    const route = polishFound(table.lookup, blocked, findRoutes(table.lookup, blocked)).byAscensions[4]!;
    const s = enumerateChains(table.lookup, legHours, blocked, route, route.end + 2 * DAY);
    expect(s.count).toBeGreaterThan(0);
    const hourOf = (t: number) =>
      Number(
        new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: PACIFIC_TIMEZONE }).format(
          t * 1000
        )
      );
    for (const t of s.prestiges) expect(hourOf(t) >= 7 && hourOf(t) < 23).toBe(true);
  }, 60_000);
});
