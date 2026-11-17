// The 2x capacity window together with a sleep window: the wall-clock window rows, the twin each doubled group is
// demoted to, the doubled-first layout and the demotion of what still misses the window. See
// `lib/mission-optimizer/solver/SPEC.md` section 13. Every calendar here is small enough to check by hand: a
// 16-hour waking day, then 8 hours of sleep.

import { describe, expect, it } from 'vitest';
import { capacityVariants } from 'lib/mission-optimizer/capacity';
import { lastWakingInstant } from 'lib/mission-optimizer/solver/days';
import { EXACT_PRECISION, STEERING_PRECISION, evaluateCounts } from 'lib/mission-optimizer/solver/evaluator';
import { loadHighs } from 'lib/mission-optimizer/solver/highs';
import { layOutPlan } from 'lib/mission-optimizer/solver/layout';
import { buildModel } from 'lib/mission-optimizer/solver/model';
import { buildOaMilp, effectiveQs, layoutOf, nCol, scaleLps } from 'lib/mission-optimizer/solver/milp';
import { DEFAULT_TUNING, assertVerified, solveWith } from 'lib/mission-optimizer/solver/solve';
import { DAY_SECONDS, normalizeProblem, type PlanProblem } from 'lib/mission-optimizer/solver/types';
import { slotFault } from 'lib/mission-optimizer/solver/verify';
import type { LaunchOption } from 'lib/mission-optimizer/types';
import { craftDag, makeOpt } from './spec-helpers';

const H = 3600;
const S = 8 * H;
const W = DAY_SECONDS - S;

function opt(hours: number, nights = 0, yieldB = 1, fuel = 1): LaunchOption {
  return { ...makeOpt(fuel, hours * H, [['B', yieldB]]), nights };
}

// The app's own capacity split, applied to a menu already split by sleep.
function doubles(options: LaunchOption[], window: number): LaunchOption[] {
  return [...capacityVariants(options, window)];
}

// A problem the way the app and the arena state one: waking seconds and nights from the horizon, the sleep window,
// and the event window.
function problemOf(options: LaunchOption[], horizon: number, window?: number, extra: Partial<PlanProblem> = {}) {
  const n = Math.floor(horizon / DAY_SECONDS);
  const problem: PlanProblem = {
    options,
    dag: craftDag(0.1),
    targets: ['A'],
    fuelCapacity: 1e6,
    timeCapacityPerSlot: n * W + Math.min(horizon - n * DAY_SECONDS, W),
    nightsPerSlot: n,
    sleep: { sleepSeconds: S, horizonSeconds: horizon },
    ...(window !== undefined && { eventWindowSeconds: window }),
    slots: 3,
    ownedStock: new Map<string, number>(),
    ...extra,
  };
  return problem;
}

// The MILP's class columns as if it had put `perSlot[i]` launches of option `i` in every slot, and the group
// counts that go with them; then the layout of exactly that.
function layOut(problem: PlanProblem, perSlot: number[]) {
  const model = buildModel(problem);
  const layout = layoutOf(model, 'oa');
  const values = new Float64Array(layout.columnCount);
  const counts = new Array<number>(model.groups.length).fill(0);
  model.groups.forEach((grp, g) => {
    const n = perSlot[grp.members[0]] ?? 0;
    for (let k = 0; k < model.slots; k++) values[nCol(layout, layout.classOf[g], k)] += n;
    counts[g] = n * model.slots;
  });
  return { model, layout, values, counts };
}

async function laidOut(problem: PlanProblem, perSlot: number[]) {
  const solve = await loadHighs();
  const { model, layout, values, counts } = layOut(problem, perSlot);
  const judge = (c: readonly number[]) => evaluateCounts(model, c, STEERING_PRECISION).logJoint;
  const laid = layOutPlan(model, layout, values, counts, problem.options, solve, judge);
  // The calendar must pass the same gate `emit` holds every plan to.
  const allocation = new Array<number>(problem.options.length).fill(0);
  model.groups.forEach((grp, g) => (allocation[grp.members[0]] += laid.counts[g]));
  expect(() => assertVerified(problem, model, allocation, laid.calendar)).not.toThrow();
  return { model, laid, allocation };
}

// Each slot as [hours from wake-up on day 0, doubled] pairs.
function shape(calendar: { launchAt: number; doubled: boolean }[][]) {
  return calendar.map(slot => slot.map(l => [Math.round((l.launchAt / H) * 1000) / 1000, l.doubled]));
}

const variantOf = (problem: PlanProblem, option: number) => problem.options[option].variant ?? 'normal';

describe('the window rows under sleep', () => {
  it('reads the window up to the last waking instant before it closes', () => {
    expect(lastWakingInstant(10 * H, W)).toBe(10 * H);
    // Closing at 20:00 into day 0, four hours after bedtime: the last launch can go at bedtime.
    expect(lastWakingInstant(20 * H, W)).toBe(16 * H);
    expect(lastWakingInstant(30 * H, W)).toBe(30 * H);
    expect(lastWakingInstant(46 * H, W)).toBe(40 * H);
  });

  it('charges an event launch its wall-clock block against that instant, and drops one that cannot fit', () => {
    // A 5-hour daytime ship and a 20-hour one over a night (12 waking hours and 8 asleep), with a window closing
    // in the night of day 0: 16 hours of budget. The overnight ship's block is 20 hours, so it has no event column.
    const options = doubles([opt(5), opt(12, 1, 3)], 20 * H);
    const problem = problemOf(options, 2 * DAY_SECONDS, 20 * H);
    const model = buildModel(problem);
    expect(model.eventWindowBudget).toBe(16 * H);
    const layout = layoutOf(model, 'oa');
    const milp = buildOaMilp(model, effectiveQs(model), [1], DEFAULT_TUNING.sigmaGrid);
    const r = milp.rowNames.indexOf('window_k0');
    const end = milp.offsets[r + 1];
    const entries: [string, number, number][] = [];
    for (let i = milp.offsets[r]; i < end; i++) {
      const c = Math.floor(milp.indices[i] / 3);
      entries.push([layout.classVariant[c], layout.classNights[c], milp.values[i]]);
    }
    expect(entries).toEqual([['event', 0, 5 * H]]);
    expect(milp.rowUpper[r]).toBe(16 * H);
    // The overnight event copy is gone; its overhang copy stays, and so do both normal ones.
    expect(model.groups.map(g => [g.timeSeconds / H, g.nights, g.variant]).sort()).toEqual(
      [
        [5, 0, 'event'],
        [5, 0, 'normal'],
        [5, 0, 'overhang'],
        [12, 1, 'normal'],
        [12, 1, 'overhang'],
      ].sort()
    );
    // Three 5-hour event launches fit 16 hours, so that is the class's per-slot bound and nine the group's.
    const event = model.groups.findIndex(g => g.variant === 'event');
    expect(layout.classCap[layout.classOf[event]]).toBe(3);
    expect(model.groups[event].cap).toBe(9);
  });

  it('an overnight event launch counts its nights: two 20-hour ships in a 54-hour window, not four', () => {
    const problem = problemOf(doubles([opt(12, 1)], 54 * H), 4 * DAY_SECONDS, 54 * H);
    const model = buildModel(problem);
    const layout = layoutOf(model, 'oa');
    const event = model.groups.findIndex(g => g.variant === 'event');
    // By waking seconds alone it would be floor(54 / 12) = 4.
    expect(layout.classCap[layout.classOf[event]]).toBe(2);
  });
});

describe('the twin a doubled group is flown as', () => {
  it('is its own normal copy', () => {
    const options = doubles([opt(5)], 10 * H);
    const model = buildModel(problemOf(options, DAY_SECONDS, 10 * H));
    for (const grp of model.groups) {
      if (grp.variant === 'normal') expect(grp.twin).toBe(-1);
      else expect(model.groups[grp.twin].members).toEqual([options.findIndex(o => o.variant === 'normal')]);
    }
  });

  it('is the normal group that dominates it, when dominance pruned the copy itself', () => {
    // The 10-hour ship's normal copy is pruned by the 8-hour one, which flies the same launch in less time.
    const slow = opt(10);
    const fast = opt(8);
    const options = [slow, doubles([slow], 0.5 * H).find(o => o.variant === 'overhang')!, fast];
    expect(options[1].variant).toBe('overhang');
    const model = buildModel(problemOf(options, DAY_SECONDS, 0.5 * H));
    expect(model.groups.map(g => g.members[0]).sort()).toEqual([1, 2]);
    const overhang = model.groups.find(g => g.variant === 'overhang')!;
    expect(model.groups[overhang.twin].members).toEqual([2]);
  });

  it('is absent when the menu has no normal copy, and then a missed launch is trimmed', async () => {
    const options = doubles([opt(10)], 30 * H).filter(o => o.variant !== 'normal');
    const problem = problemOf(options, 3 * DAY_SECONDS, 30 * H);
    const { model, laid } = await laidOut(problem, [2, 1]);
    expect(model.groups.every(g => g.twin === -1)).toBe(true);
    expect(laid.stats).toMatchObject({ launchesTrimmed: 3, launchesDemoted: 0 });
    for (const slot of shape(laid.calendar))
      expect(slot).toEqual([
        [0, true],
        [24, true],
      ]);
  });
});

describe('laying a window out on real days', () => {
  it('window ends mid-day: doubled launches go first, back to back, then the rest', async () => {
    // A 3-hour ship, a 10-hour window, two days. Per slot three event launches and the overhang: 0, 3, 6, 9.
    const problem = problemOf(doubles([opt(3)], 10 * H), 2 * DAY_SECONDS, 10 * H);
    const { laid } = await laidOut(problem, [6, 3, 1]);
    for (const slot of shape(laid.calendar)) {
      expect(slot).toEqual([
        [0, true],
        [3, true],
        [6, true],
        [9, true],
        [12, false],
        [24, false],
        [27, false],
        [30, false],
        [33, false],
        [36, false],
      ]);
    }
    expect(laid.stats).toMatchObject({ launchesTrimmed: 0, launchesDemoted: 0 });
  });

  it('window ends during sleep: the bedtime launch is the overhang', async () => {
    // Closing at 20:00, after bedtime at 16:00. Three 5-hour event launches, then a short overnight ship as the
    // overhang, the last launch before bed: a doubled ship takes off as soon as its day allows, here at 15:00, and
    // the 1x one waits for bedtime. Day 1 flies the same at 1x.
    const options = [...doubles([opt(5)], 20 * H), ...doubles([opt(0, 1)], 20 * H)];
    const problem = problemOf(options, 2 * DAY_SECONDS, 20 * H);
    const index = (hours: number, variant: string) =>
      options.findIndex(o => o.actualTime === hours * H && (o.variant ?? 'normal') === variant);
    const perSlot = new Array<number>(options.length).fill(0);
    perSlot[index(5, 'event')] = 3;
    perSlot[index(5, 'normal')] = 3;
    perSlot[index(0, 'overhang')] = 1;
    perSlot[index(0, 'normal')] = 1;
    const { laid } = await laidOut(problem, perSlot);
    for (const slot of laid.calendar) {
      expect(shape([slot])[0]).toEqual([
        [0, true],
        [5, true],
        [10, true],
        [15, true],
        [24, false],
        [29, false],
        [34, false],
        [40, false],
      ]);
      expect(variantOf(problem, slot[3].option)).toBe('overhang');
      expect(slot[3].nights).toBe(1);
    }
  });

  it('window shorter than one waking day: an overnight doubled ship takes off early to make it', async () => {
    // A 48-hour ship over two nights (32 waking hours, so up to 16 before the first bedtime) as the overhang, and
    // two 1-hour event launches, in a 3-hour window: 0, 1, and the long ship at 2:00, landing at 2:00 on day 2.
    const options = [...doubles([opt(32, 2, 9)], 3 * H), ...doubles([opt(1)], 3 * H)];
    const problem = problemOf(options, 3 * DAY_SECONDS, 3 * H);
    const perSlot = new Array<number>(options.length).fill(0);
    perSlot[options.findIndex(o => o.nights === 2 && o.variant === 'overhang')] = 1;
    perSlot[options.findIndex(o => o.nights === 0 && o.variant === 'event')] = 2;
    const { laid } = await laidOut(problem, perSlot);
    for (const slot of laid.calendar) {
      expect(shape([slot])[0]).toEqual([
        [0, true],
        [1, true],
        [2, true],
      ]);
      expect(slot[2].nights).toBe(2);
    }
  });

  it('a 1x daytime launch waits until after the doubled ships rather than push one past the window', async () => {
    // A doubled 48-hour ship (32 waking hours over two nights) and one 5-hour ship at 1x, a 3-hour window and three
    // days. Flown first, the 5-hour ship would put the doubled one's take-off at 5:00; it goes on day 2 instead.
    const options = [...doubles([opt(32, 2, 9)], 3 * H), ...doubles([opt(5)], 3 * H)];
    const problem = problemOf(options, 3 * DAY_SECONDS, 3 * H);
    const perSlot = new Array<number>(options.length).fill(0);
    perSlot[options.findIndex(o => o.nights === 2 && o.variant === 'overhang')] = 1;
    perSlot[options.findIndex(o => o.nights === 0 && o.variant === 'normal')] = 1;
    const { laid } = await laidOut(problem, perSlot);
    for (const slot of shape(laid.calendar))
      expect(slot).toEqual([
        [0, true],
        [48, false],
      ]);
    expect(laid.stats.launchesDemoted).toBe(0);
  });

  it('window spanning two nights: overnight doubled ships take the first nights', async () => {
    // A 20-hour ship over one night (12 waking hours), every night of four days. A doubled one takes off at wake-up,
    // landing before the next; a 1x one at 4:00, the latest it can and still land at wake-up. A 54-hour window takes
    // the first three, at 0:00, 24:00 and 48:00; the fourth, at 76:00, flies 1x.
    const options = doubles([opt(12, 1)], 54 * H);
    const problem = problemOf(options, 4 * DAY_SECONDS, 54 * H);
    const perSlot = options.map(o => (o.variant === 'event' ? 2 : 1));
    const { laid } = await laidOut(problem, perSlot);
    for (const slot of laid.calendar) {
      expect(shape([slot])[0]).toEqual([
        [0, true],
        [24, true],
        [48, true],
        [76, false],
      ]);
      expect(slot.map(l => variantOf(problem, l.option))).toEqual(['event', 'event', 'overhang', 'normal']);
    }
    expect(laid.stats.launchesDemoted).toBe(0);
  });

  it('a doubled launch the days push past the window is demoted to its twin, not dropped', async () => {
    // 10-hour ships, one a waking window, so they go at 0:00, 24:00 and 48:00. The rows allow three doubled ones
    // in a 30-hour window (20 event hours and the overhang); the days only start two inside it.
    const options = doubles([opt(10)], 30 * H);
    const problem = problemOf(options, 3 * DAY_SECONDS, 30 * H);
    const { model, laid } = await laidOut(problem, [0, 2, 1]);
    expect(laid.stats).toMatchObject({ launchesTrimmed: 0, launchesDemoted: 3 });
    for (const slot of shape(laid.calendar))
      expect(slot).toEqual([
        [0, true],
        [24, true],
        [48, false],
      ]);
    const normal = model.groups.findIndex(g => g.variant === 'normal');
    expect(laid.counts[normal]).toBe(3);
    expect(laid.counts.reduce((a, b) => a + b, 0)).toBe(9);
  });

  it('the judge picks which doubled launch is demoted, so demotion decides the plan', async () => {
    // Two 10-hour ships in one class: X yields twice what Y does for twice the fuel, so neither prunes the other.
    // Per slot an X and a Y event launch and an X overhang; one of the three misses the window. Demoting Y costs
    // one B, demoting either X two, so the judge demotes the Y every time — not the overhang, nor the first found.
    const x = opt(10, 0, 2, 2);
    const y = opt(10, 0, 1, 1);
    const options = doubles([x, y], 30 * H);
    const problem = problemOf(options, 3 * DAY_SECONDS, 30 * H);
    const find = (id: string) => options.findIndex(o => o.id === id);
    const perSlot = new Array<number>(options.length).fill(0);
    perSlot[find(`${x.id}::event`)] = 1;
    perSlot[find(`${y.id}::event`)] = 1;
    perSlot[find(`${x.id}::overhang`)] = 1;
    const { model, laid, allocation } = await laidOut(problem, perSlot);
    expect(laid.stats.launchesDemoted).toBe(3);
    expect(allocation[find(`${x.id}::event`)]).toBe(3);
    expect(allocation[find(`${x.id}::overhang`)]).toBe(3);
    expect(allocation[find(y.id)]).toBe(3);
    expect(allocation[find(`${y.id}::event`)]).toBe(0);
    // And it is the better of the plans the demotion could have left.
    const countsOf = (alloc: number[]) => model.groups.map(g => alloc[g.members[0]]);
    const judged = (alloc: number[]) => evaluateCounts(model, countsOf(alloc), STEERING_PRECISION).logJoint;
    const otherwise = allocation.slice();
    otherwise[find(`${x.id}::overhang`)] = 0;
    otherwise[find(x.id)] = 3;
    otherwise[find(`${y.id}::event`)] = 3;
    otherwise[find(y.id)] = 0;
    expect(judged(allocation)).toBeGreaterThan(judged(otherwise));
  });
});

describe('solving a window with sleep', () => {
  it('reports the plan the calendar flies, demoted launches at 1x', async () => {
    const solve = await loadHighs();
    const options = doubles([opt(10)], 30 * H);
    const problem = problemOf(options, 3 * DAY_SECONDS, 30 * H);
    const result = solveWith(problem, solve, DEFAULT_TUNING, { report: true });
    // Three a slot, one a waking window, as the fit rows say; the rows let all three be doubled, the days two.
    const byVariant = (v: string) =>
      result.allocation.reduce((a, n, i) => a + (variantOf(problem, i) === v ? n : 0), 0);
    expect(byVariant('normal')).toBe(3);
    expect(byVariant('event') + byVariant('overhang')).toBe(6);
    expect(result.layoutStats).toMatchObject({ launchesTrimmed: 0, launchesDemoted: 3 });
    for (const slot of result.calendar!) {
      expect(slotFault(slot, problem.sleep!, problem.eventWindowSeconds)).toBeNull();
      for (const l of slot) if (l.doubled) expect(l.launchAt).toBeLessThanOrEqual(30 * H);
    }
    const model = buildModel(problem);
    const counts = model.groups.map(g => result.allocation[g.members[0]]);
    const exact = evaluateCounts(model, counts, EXACT_PRECISION).scores.map(s => -Math.expm1(-s));
    expect(result.reported!.jointProbability).toBe(exact[0]);
  });

  it('normalizes a problem carrying both, and keeps a malformed window at none', () => {
    const problem = problemOf([], 2 * DAY_SECONDS, 3600);
    expect(normalizeProblem(problem).eventWindowSeconds).toBe(3600);
    expect(normalizeProblem({ ...problem, eventWindowSeconds: NaN }).eventWindowSeconds).toBe(0);
  });
});

describe('a sleep problem with a zero or absent window is today’s sleep problem', () => {
  const menu = () => [opt(5.88), opt(0, 1), opt(10.8, 0, 3, 2), opt(12, 1, 4, 3), opt(32, 2, 9, 5)];
  const matricesOf = (problem: PlanProblem) => {
    const model = buildModel(problem);
    const qs = effectiveQs(model);
    return { milp: buildOaMilp(model, qs, [1], DEFAULT_TUNING.sigmaGrid), scale: scaleLps(model, qs)(0) };
  };

  it('matches matrix for matrix, doubled copies on the menu or not', () => {
    const today = matricesOf(problemOf(menu(), 4 * DAY_SECONDS));
    const restated: [LaunchOption[], number | undefined][] = [
      [menu(), 0],
      [menu().map(o => ({ ...o, variant: 'normal' as const })), undefined],
      [menu().map(o => ({ ...o, variant: 'normal' as const })), 0],
      [[...menu(), ...doubles(menu(), 10 * H).filter(o => o.variant !== 'normal')], undefined],
      [[...menu(), ...doubles(menu(), 10 * H).filter(o => o.variant !== 'normal')], 0],
    ];
    for (const [options, window] of restated) {
      const other = matricesOf(problemOf(options, 4 * DAY_SECONDS, window));
      expect(other.milp).toEqual(today.milp);
      expect(other.scale).toEqual(today.scale);
    }
  });

  it('returns the same plan, and layout statistics without a demotion count', async () => {
    const solve = await loadHighs();
    const options = menu();
    const absent = solveWith(problemOf(options, 4 * DAY_SECONDS), solve, DEFAULT_TUNING, { report: true });
    const zero = solveWith(problemOf(options, 4 * DAY_SECONDS, 0), solve, DEFAULT_TUNING, { report: true });
    expect(zero).toEqual(absent);
    expect(absent.layoutStats).toBeDefined();
    expect('launchesDemoted' in absent.layoutStats!).toBe(false);
  });
});
