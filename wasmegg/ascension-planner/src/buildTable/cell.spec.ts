import { describe, expect, test } from 'vitest';
import { runAscensionFromC3Variant } from '@/auto/ascension';
import { buildsFrom, contextAt, prefixAt, startStateAt, tailTo, variantsFrom } from './cell';
import { maxedBaseState, maxedContext } from './maxedAccount';
import { crossesBoundary, eventClassAt, hourStart, prefixSourceFor, SEED_HOURS } from './prefixReuse';

describe('tailTo matches the simulator', () => {
  // One fresh cell: TE 150 at Monday 00:00 Pacific of the reference week.
  const te = 150;
  const ctx = contextAt(maxedContext(), hourStart(0));
  const state = startStateAt(maxedBaseState(), te);
  const prefix = prefixAt(state, ctx);
  const variants = variantsFrom(prefix, ctx, te);
  const builds = buildsFrom(prefix, ctx, te);
  const preC3 = { actions: [], state: prefix.state, elapsedSeconds: prefix.elapsedSeconds };

  test('the cell has the 1-, 2- and 3-sale builds', () => {
    expect(builds.map(b => b.sales)).toEqual([1, 2, 3]);
    expect(builds.every(b => b.peakELR > 0 && b.waitStart > 0)).toBe(true);
  });

  test.each([151, 175, 220, 300, 400, 490])('target %i, every variant', target => {
    variants.forEach((v, i) => {
      const sim = runAscensionFromC3Variant(state, preC3, v, ctx, ctx.ascensionStartTime, 'asc', target).summary;
      const tail = tailTo(builds[i], target);
      expect(tail).not.toBeNull();
      expect(tail!.endTE).toBe(sim.endTE);
      expect(tail!.seconds).toBeCloseTo(sim.totalDurationSeconds, 3);
    });
  });
});

describe('prefix reuse schedule', () => {
  test('seeds sit in their own event class', () => {
    expect(eventClassAt(hourStart(SEED_HOURS.none))).toBe('none');
    expect(eventClassAt(hourStart(SEED_HOURS.sale))).toBe('sale');
    expect(eventClassAt(hourStart(SEED_HOURS.boost))).toBe('boost');
  });

  test('an hour reuses its seed only when its prefix window crosses no boundary', () => {
    const seconds = { none: 10 * 3600, sale: 10 * 3600, boost: 10 * 3600 };
    // Thursday 12:00: next boundary is Friday 9:00, 21 h away.
    expect(prefixSourceFor(3 * 24 + 12, seconds)).toEqual({ kind: 'reuse', seedHour: SEED_HOURS.none });
    // Thursday 23:00: Friday 9:00 is 10 h away, inside the window.
    expect(crossesBoundary(hourStart(3 * 24 + 23), seconds.none)).toBe(true);
    expect(prefixSourceFor(3 * 24 + 23, seconds)).toEqual({ kind: 'fresh', reason: 'crosses' });
    // Friday 12:00 is inside the sale, 21 h before it ends.
    expect(prefixSourceFor(4 * 24 + 12, seconds)).toEqual({ kind: 'reuse', seedHour: SEED_HOURS.sale });
  });
});
