/**
 * Chain Finder on the deployed maxed table (public/instant/table.bin.gz). The pinned answers were
 * checked against AutoAutoAP's own findRoutes + polishFound (ascension-chain-search at f93e05f0) on
 * the same table, route for route and to the second.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { getLocalTimestampInTimezone, PACIFIC_TIMEZONE } from 'lib/planners/events';
import { runContinueCurrent } from '@/auto/ascension';
import { maxedBaseState, maxedContext } from '@/buildTable/maxedAccount';
import { startStateAt } from '@/buildTable/cell';
import { canonicalDelivered, EGG_ORDER, tailTo, type BuildParams } from './precomputedLeg';
import {
  CONTINUE_MAX_SECONDS,
  findRoutes,
  firstLegOptions,
  holdArrival,
  lastTE,
  MAX_WAIT_HOURS,
  mergeBlocked,
  nextAllowed,
  nextHour,
  polishFound,
  type Blocked,
  type FoundRoutes,
  type Route,
} from './routeFinder';
import { hoursBlocked, nextDate } from './blockedTime';
import { readTable } from './table';

const gz = readFileSync(new URL('../../../public/instant/table.bin.gz', import.meta.url));
const bytes = gunzipSync(gz);
const table = readTable(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const pt = (date: string, time: string) => getLocalTimestampInTimezone(date, time, PACIFIC_TIMEZONE);

function search(o: Parameters<typeof findRoutes>[1]) {
  return polishFound(table.lookup, o, findRoutes(table.lookup, o));
}

/** An ascension in progress at `te`: the canonical counts plus `extra` eggs on integrity, laying at
 *  `scale` times the table's peak delivery rate there (lib/instantSearch/currentAscension.ts's shape). */
function inProgress(te: number, scale: number, extra: number): BuildParams {
  const delivered = [...canonicalDelivered(te)];
  delivered[EGG_ORDER.indexOf('integrity')] += extra;
  const peakELR = table.lookup(te, 0)![0].peakELR * scale;
  return { sales: 0, tier13: false, waitStart: 0, saleEnd: 0, peakELR, delivered };
}

/** Every count's first step from 1 ascension up: C continues, P prestiges, - no route. With an ascension
 *  in progress it counts as one: a prestige-first route is one more ascension than its legs. */
const firstSteps = (routes: ({ legs: { continued?: boolean }[] } | null)[]) =>
  routes
    .slice(1)
    .map(r => (r ? (r.legs[0].continued ? 'C' : 'P') : '-'))
    .join('');

describe('instant search', () => {
  it('finds the fastest route to a target TE', () => {
    const start = pt('2026-10-22', '01:30');
    const found = search({ startTE: 226, start, final: 490, maxAscensions: 12 });
    expect(found.best?.chain).toEqual([257, 288, 329, 490]);
    expect(found.best!.seconds / 86400).toBeCloseTo(606.59, 2);
    // Every count's route ends at the target, its legs chained end to start.
    for (const r of found.byAscensions.filter(r => r !== null)) {
      expect(r.chain.at(-1)).toBe(490);
      r.legs.forEach((l, i) => i && expect(l.start).toBeGreaterThanOrEqual(r.legs[i - 1].end));
    }
  });

  it('finds the same routes for the counts it reaches when stopped at a lower count', () => {
    const start = pt('2026-10-22', '01:30');
    for (const extra of [{}, { waitForEggs: true }, { deadline: start + 120 * 86400 }]) {
      const o = { startTE: 226, start, final: 490, ...extra };
      const all = search({ ...o, maxAscensions: 12 });
      const capped = search({ ...o, maxAscensions: 4 });
      expect(capped.byAscensions).toEqual(all.byAscensions.slice(0, 5));
      expect(capped.byDateByAscensions).toEqual(all.byDateByAscensions.slice(0, 5));
    }
  }, 30_000);

  it('continues the ascension in progress when that is sooner', () => {
    // A strong farm at 300 TE with integrity part-way to its next TE.
    const start = pt('2026-10-20', '08:13');
    const cont = inProgress(300, 1, 1e17);
    const found = search({ startTE: 300, start, final: 490, maxAscensions: 12, startDelivered: cont.delivered, cont });
    expect(found.best?.chain).toEqual([321, 332, 490]);
    expect(found.best!.legs[0]).toMatchObject({ continued: true, start, from: 300, to: 321 });
    // 1 ascension: continue straight to 490. Every count from 2 continues first too (prestiging now and
    // going straight to 490 would also be 2, and is slower).
    expect(firstSteps(found.byAscensions)).toBe('CCCCCCCCCCCC');
    // A prestige-first route counts the ascension it ends: one more than its legs.
    for (const [k, r] of found.byAscensions.entries())
      if (r) expect(r.legs.length + (r.legs[0].continued ? 0 : 1)).toBe(k);
  });

  it('prestiges now when the farm in progress is slow', () => {
    const start = pt('2026-10-20', '08:13');
    const cont = inProgress(226, 0.02, 1e15);
    const found = search({ startTE: 226, start, final: 490, maxAscensions: 12, startDelivered: cont.delivered, cont });
    // A 1-TE ascension at 287 lays an hour's eggs and starts the next build at a better hour.
    expect(found.best?.chain).toEqual([257, 287, 288, 329, 490]);
    expect(found.best!.legs[0].continued).toBeUndefined();
    // A prestige starts on the next whole hour.
    expect(found.best!.legs[0].start).toBe(Math.ceil(start / 3600) * 3600);
    // 1 ascension is still there: continuing all the way, however long (CONTINUE_MAX_SECONDS is only
    // for stops on the way).
    expect(firstSteps(found.byAscensions)).toBe('CPPPPPPPPPPP');
    const one = found.byAscensions[1]!;
    expect(one.chain).toEqual([490]);
    expect(one.seconds).toBeGreaterThan(CONTINUE_MAX_SECONDS);
  });

  it('continues by a date too', () => {
    const start = pt('2026-10-20', '08:13');
    const cont = inProgress(330, 0.9, 1e17);
    const deadline = pt('2027-07-14', '09:00');
    const found = search({ startTE: 330, start, final: 490, maxAscensions: 12, startDelivered: cont.delivered, cont, deadline });
    expect(found.byDate?.chain).toEqual([331, 447]);
    expect(found.byDate!.legs[0].continued).toBe(true);
  });

  it("prices continuing as the simulator's runContinueCurrent does, eggs since the last sync included", () => {
    const context = maxedContext();
    const start = pt('2026-10-20', '08:13');
    const since = 5 * 3600;
    const cont = inProgress(300, 0.5, 3e16);
    const state = startStateAt(maxedBaseState(), 300);
    state.currentEgg = 'integrity';
    EGG_ORDER.forEach((e, i) => (state.eggsDelivered[e] = cont.delivered[i]));
    state.lastStepTime = start - since;
    // currentAscension.ts's catch-up: the farm's rate since the last sync, on the egg it is on.
    const caughtUp = { ...cont, delivered: [...cont.delivered] };
    caughtUp.delivered[EGG_ORDER.indexOf('integrity')] += cont.peakELR * since;
    for (const target of [301, 305, 318, 340, 400, 490]) {
      const sim = runContinueCurrent(state, { ...context, ascensionStartTime: start }, start, cont.peakELR, target).summary;
      const tail = tailTo(caughtUp, target)!;
      expect(tail.endTE).toBe(sim.endTE);
      expect(tail.seconds).toBeCloseTo(sim.totalDurationSeconds, 0);
    }
  });

  describe('dates to avoid', () => {
    const start = pt('2026-10-22', '01:30');
    const base = { startTE: 226, start, final: 490, maxAscensions: 12 };
    const day = (date: string): [number, number] => [pt(date, '00:00'), pt(date, '00:00') + 86400];
    /** Every prestige (each leg that doesn't continue) starts outside the blocked spans. */
    const prestigesClear = (r: Route, avoid: Blocked) =>
      r.legs.every(l => l.continued || avoid.every(([a, b]) => l.start < a || l.start >= b));

    it('holds a prestige that falls on an avoided day, and the route is never sooner than with waits for eggs', () => {
      const free = search(base).best!;
      // A held prestige's eggs can beat not waiting at all, but never the best waits.
      const waits = search({ ...base, waitForEggs: true }).best!;
      // The day of the route's second prestige.
      const pacificDay = new Intl.DateTimeFormat('en-CA', { timeZone: PACIFIC_TIMEZONE }).format(free.legs[1].start * 1000);
      const avoid = mergeBlocked([day(pacificDay)]);
      const found = search({ ...base, avoid });
      for (const r of found.byAscensions.filter(r => r !== null)) expect(prestigesClear(r, avoid)).toBe(true);
      expect(found.best!.end).toBeGreaterThanOrEqual(waits.end);
    }, 120_000);

    it('waits out a vacation of several days in a row', () => {
      // Ten days from the plan start: the first prestige waits until they're over.
      const days = Array.from({ length: 10 }, (_, i) => day(new Date((start + i * 86400) * 1000).toISOString().slice(0, 10)));
      const avoid = mergeBlocked(days);
      expect(avoid).toHaveLength(1);
      const found = search({ ...base, avoid });
      const first = found.best!.legs[0];
      expect(first.held).toBe(true);
      expect(first.start).toBe(Math.ceil(avoid[0][1] / 3600) * 3600);
      for (const r of found.byAscensions.filter(r => r !== null)) expect(prestigesClear(r, avoid)).toBe(true);
    });

    it('lets the ascension in progress continue through an avoided day', () => {
      const s = pt('2026-10-20', '08:13');
      const cont = inProgress(300, 1, 1e17);
      const avoid = mergeBlocked([day('2026-10-20'), day('2026-10-21')]);
      const found = search({ startTE: 300, start: s, final: 490, maxAscensions: 12, startDelivered: cont.delivered, cont, avoid });
      expect(found.best!.legs[0].continued).toBe(true);
      for (const r of found.byAscensions.filter(r => r !== null)) expect(prestigesClear(r, avoid)).toBe(true);
    });

    it('credits the eggs laid while a prestige waits', () => {
      const farm = { egg: 2, rate: 1e12 };
      const eggs = [...canonicalDelivered(300)];
      // Reached on the avoided day itself.
      const reached = pt('2026-12-25', '06:20');
      const avoid = mergeBlocked([day('2026-12-25')]);
      const h = holdArrival(reached, eggs, farm, avoid);
      expect(h.held).toBe(true);
      expect(h.at).toBe(pt('2026-12-26', '00:00'));
      // From the stop's reaching to the prestige, the round-up to the next whole hour included.
      expect(h.delivered[2] - eggs[2]).toBeCloseTo(1e12 * (h.at - reached), -3);
      expect(h.te).toBeGreaterThanOrEqual(300);
      // Nothing blocked: the round-up to 07:00 alone, not held.
      const free = holdArrival(reached, eggs, farm, []);
      expect(free.held).toBe(false);
      expect(free.delivered[2] - eggs[2]).toBeCloseTo(1e12 * (pt('2026-12-25', '07:00') - reached), -3);
    });

    it('carries the eggs laid while waiting into the next ascension, TE and all', () => {
      // Prestiges allowed only on Sundays, 10-11 AM: every one waits, the farm laying on meanwhile.
      const s = pt('2026-10-20', '08:13');
      const cont = inProgress(300, 1, 1e17);
      const open = 6 * 24 + 10;
      const avoid = hoursBlocked(Array.from({ length: 168 }, (_, i) => i).filter(i => i !== open), PACIFIC_TIMEZONE, s);
      const found = search({
        startTE: 300, start: s, final: 490, maxAscensions: 6, startDelivered: cont.delivered, cont, contEgg: 2, avoid,
      });
      const routes = found.byAscensions.filter((r): r is Route => r !== null);
      // Counts 1-6 (1: continuing straight to 490).
      expect(routes.length).toBe(6);
      let gained = 0;
      for (const r of routes) {
        expect(prestigesClear(r, avoid)).toBe(true);
        r.legs.forEach((l, i) => {
          if (l.continued) return;
          // Held exactly when the prestige came after the next whole hour from the stop (or the start).
          const reachedAt = i ? r.legs[i - 1].end : s;
          expect(l.held === true).toBe(l.start > nextHour(reachedAt));
          // Each ascension starts at no less than the TE the last one reached; more when the wait made more.
          const before = i ? r.legs[i - 1].endTE : 300;
          expect(l.from).toBeGreaterThanOrEqual(before);
          if (l.from > before) gained++;
        });
      }
      expect(gained).toBeGreaterThan(0);
      // Prestiging now waits too, and the farm in progress lays on meanwhile: the fresh build starts higher.
      const firsts = firstLegOptions(table.lookup, {
        startTE: 300, start: s, final: 490, maxAscensions: 6, startDelivered: cont.delivered, cont, contEgg: 2, avoid,
      });
      const prestiges = firsts.filter(f => !f.continued);
      expect(prestiges.length).toBeGreaterThan(0);
      for (const f of prestiges) {
        expect(f.held).toBe(true);
        expect(f.from).toBeGreaterThan(300);
      }
    });

    it('holds prestiges out of nightly sleep hours, every night', () => {
      const sleep = [0, 1, 2, 3, 4, 5, 6].flatMap(d => [23, 0, 1, 2, 3, 4, 5, 6].map(h => d * 24 + h));
      const avoid = hoursBlocked(sleep, PACIFIC_TIMEZONE, start);
      const found = search({ ...base, avoid });
      const hourOf = (t: number) =>
        Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: PACIFIC_TIMEZONE }).format(t * 1000));
      for (const r of found.byAscensions.filter((r): r is Route => r !== null))
        for (const l of r.legs) {
          const h = hourOf(l.start);
          expect(h >= 7 && h < 23).toBe(true);
        }
      expect(found.best).not.toBeNull();
    });

    it('merges touching and overlapping spans', () => {
      expect(mergeBlocked([[10, 20], [0, 5], [5, 8], [15, 30], [40, 50]])).toEqual([[0, 8], [10, 30], [40, 50]]);
      expect(nextAllowed(12, [[10, 30]])).toBe(30);
      expect(nextAllowed(30, [[10, 30]])).toBe(30);
    });
  });

  describe('waiting for eggs', () => {
    const start = pt('2026-10-22', '01:30');
    const base = { startTE: 226, start, final: 490, maxAscensions: 12 };
    let plainFound: FoundRoutes | null = null;
    let waitFound: FoundRoutes | null = null;
    const plain = () => (plainFound ??= search(base));
    const waited = () => (waitFound ??= search({ ...base, waitForEggs: true }));

    /** Each leg starts no sooner than the last ended, a prestige that waited exactly its wait past the
     *  next whole hour (nothing blocked), from at least the TE reached. */
    function checkWaits(r: Route, avoid?: Blocked) {
      r.legs.forEach((l, i) => {
        if (!l.waited) return;
        expect(l.held).toBeUndefined();
        expect(l.waited).toBeGreaterThan(0);
        expect(l.waited).toBeLessThanOrEqual(MAX_WAIT_HOURS * 3600);
        expect(l.start % 3600).toBe(0);
        if (i === 0) return;
        const prev = r.legs[i - 1];
        expect(l.from).toBeGreaterThanOrEqual(prev.endTE);
        if (!avoid) expect(l.start).toBe(nextHour(prev.end) + l.waited);
        // The wait to tell runs from the last whole TE reached: the stop, or a threshold the wait passed.
        expect(l.waitFrom).toBeGreaterThanOrEqual(prev.end);
        expect(l.waitFrom).toBeLessThanOrEqual(l.start);
        if (l.from > prev.endTE) expect(l.waitFrom).toBeGreaterThan(prev.end);
        else expect(l.waitFrom).toBe(prev.end);
      });
      r.legs.forEach((l, i) => i && expect(l.start).toBeGreaterThanOrEqual(r.legs[i - 1].end));
    }

    it('ends every count no later, and the fastest sooner, with prestiges that wait', () => {
      const a = plain();
      const b = waited();
      for (const [k, r] of b.byAscensions.entries()) {
        if (!a.byAscensions[k]) continue;
        expect(r).not.toBeNull();
        expect(r!.chain.at(-1)).toBe(490);
        expect(r!.end).toBeLessThanOrEqual(a.byAscensions[k]!.end);
        checkWaits(r!);
      }
      expect(b.best!.end).toBeLessThan(a.best!.end - 3600);
      expect(b.best!.legs.some(l => l.waited)).toBe(true);
    }, 120_000);

    it('changes nothing when off', () => {
      for (const r of plain().byAscensions) r?.legs.forEach(l => expect(l.waited).toBeUndefined());
    }, 120_000);

    it('keeps waiting prestiges out of blocked hours', () => {
      const sleep = [0, 1, 2, 3, 4, 5, 6].flatMap(d => [23, 0, 1, 2, 3, 4, 5, 6].map(h => d * 24 + h));
      const avoid = hoursBlocked(sleep, PACIFIC_TIMEZONE, start);
      const found = search({ ...base, avoid, waitForEggs: true });
      const hourOf = (t: number) =>
        Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: PACIFIC_TIMEZONE }).format(t * 1000));
      for (const r of found.byAscensions.filter((r): r is Route => r !== null)) {
        checkWaits(r, avoid);
        for (const l of r.legs) {
          const h = hourOf(l.start);
          expect(h >= 7 && h < 23).toBe(true);
        }
      }
    }, 120_000);

    it('can wait before ending the ascension in progress, its farm laying meanwhile', () => {
      const s = pt('2026-10-20', '08:13');
      const cont = inProgress(226, 0.02, 1e15);
      const o = { startTE: 226, start: s, final: 490, maxAscensions: 6, startDelivered: cont.delivered, cont, contEgg: 2 };
      const a = search(o);
      const b = search({ ...o, waitForEggs: true });
      for (const [k, r] of b.byAscensions.entries()) {
        if (!a.byAscensions[k]) continue;
        expect(r!.end).toBeLessThanOrEqual(a.byAscensions[k]!.end);
        checkWaits(r!);
        // A waiting first prestige starts its build from the farm's extra eggs.
        const first = r!.legs[0];
        if (first.waited) expect(first.start).toBe(nextHour(s) + first.waited);
      }
    }, 120_000);
  });

  it('finds the highest TE by a date', () => {
    const start = pt('2026-10-24', '06:59');
    const deadline = pt('2027-07-14', '09:00');
    const found = search({ startTE: 180, start, final: 490, maxAscensions: 12, deadline });
    expect(found.byDate?.chain).toEqual([181, 203, 229, 259, 287]);
    expect(found.byDate!.end).toBeLessThanOrEqual(deadline);
    for (const r of found.byDateByAscensions.filter(r => r !== null)) {
      expect(r.end).toBeLessThanOrEqual(deadline);
      expect(lastTE(r)).toBeLessThanOrEqual(lastTE(found.byDate!));
    }
  });
});
