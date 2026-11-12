// Step three of the sleep model: the per-day fit rows, the layout of each slot on real days, the trim of what
// does not fit, and the verifier every sleep-aware plan has to pass. See `src/lib/solver/SPEC.md` section 10.

import { describe, expect, it } from 'vitest';
import { FIT_Q_CAP, daySchedule, fitCoefficient, fitQs } from '@/lib/solver/days';
import { STEERING_PRECISION, EXACT_PRECISION, evaluateCounts } from '@/lib/solver/evaluator';
import { loadHighs } from '@/lib/solver/highs';
import { layOutPlan } from '@/lib/solver/layout';
import { buildModel } from '@/lib/solver/model';
import { buildOaMilp, effectiveQs, layoutOf, nCol } from '@/lib/solver/milp';
import { DEFAULT_TUNING, assertVerified, solveWith } from '@/lib/solver/solve';
import { DAY_SECONDS, type MilpModel, type MilpSolve, type PlanProblem, type PlanResult } from '@/lib/solver/types';
import { slotFault } from '@/lib/solver/verify';
import type { LaunchOption } from '@/lib/types';
import { craftDag, makeOpt } from './spec-helpers';

const H = 3600;
const S = 8 * H;
const W = DAY_SECONDS - S;

function opt(hours: number, nights = 0, yieldB = 1, fuel = 1): LaunchOption {
  return { ...makeOpt(fuel, hours * H, [['B', yieldB]]), nights };
}

// A problem the way the arena states one: waking seconds and nights from the horizon, and the sleep window.
function sleepProblem(
  options: LaunchOption[],
  horizon: number,
  sleep = S,
  extra: Partial<PlanProblem> = {}
): PlanProblem {
  const waking = DAY_SECONDS - sleep;
  const n = Math.floor(horizon / DAY_SECONDS);
  const rho = horizon - n * DAY_SECONDS;
  return {
    options,
    dag: craftDag(0.1),
    targets: ['A'],
    fuelCapacity: 1e6,
    timeCapacityPerSlot: n * waking + Math.min(rho, waking),
    nightsPerSlot: n,
    sleep: { sleepSeconds: sleep, horizonSeconds: horizon },
    slots: 3,
    ownedStock: new Map<string, number>(),
    ...extra,
  };
}

// The main MILP with its fit rows taken out: the night budget alone, which over-promises, so the layout has
// something to trim.
function withoutFitRows(solve: MilpSolve): MilpSolve {
  return (model, limits) => {
    if (!model.rowNames.some(n => n.startsWith('fit_'))) return solve(model, limits);
    const keep = model.rowNames.map((n, r) => (n.startsWith('fit_') ? -1 : r)).filter(r => r >= 0);
    const offsets: number[] = [];
    const indices: number[] = [];
    const values: number[] = [];
    for (const r of keep) {
      offsets.push(indices.length);
      const end = r + 1 < model.rowCount ? model.offsets[r + 1] : model.indices.length;
      for (let i = model.offsets[r]; i < end; i++) {
        indices.push(model.indices[i]);
        values.push(model.values[i]);
      }
    }
    const stripped: MilpModel = {
      ...model,
      rowCount: keep.length,
      rowNames: keep.map(r => model.rowNames[r]),
      rowLower: Float64Array.from(keep.map(r => model.rowLower[r])),
      rowUpper: Float64Array.from(keep.map(r => model.rowUpper[r])),
      offsets: Int32Array.from(offsets),
      indices: Int32Array.from(indices),
      values: Float64Array.from(values),
    };
    return solve(stripped, limits);
  };
}

function flownPerOption(result: PlanResult): number[] {
  const flown = new Array<number>(result.allocation.length).fill(0);
  for (const slot of result.calendar ?? []) for (const l of slot) flown[l.option]++;
  return flown;
}

function hoursOf(slot: { launchAt: number }[]): number[] {
  return slot.map(l => Math.round((l.launchAt / H) * 1000) / 1000);
}

describe('fit-row coefficients', () => {
  it('u^(q) of a launch that does not divide the window: floor((q+1)x)/q', () => {
    // 5.88 hours of a 16-hour window: x = 0.3675, (q+1)x = 1.1025 at q = 2, so a weight of 1/2: two per day.
    expect(fitCoefficient(5.88 * H, 0, W, 2)).toBe(0.5);
    // 10.8 hours: x = 0.675, 2x = 1.35 at q = 1, a whole window each.
    expect(fitCoefficient(10.8 * H, 0, W, 1)).toBe(1);
    // A short launch in a row for a larger q weighs nothing there.
    expect(fitCoefficient(4 * H, 0, W, 2)).toBe(0);
  });

  it('the integer branch: x itself where (q+1)x is whole, or within 1e-9 of it', () => {
    // 4 hours at q = 3: 4x = 1 exactly.
    expect(fitCoefficient(4 * H, 0, W, 3)).toBe(0.25);
    // A third of a window, with float noise past the last digit: 3x = 1 + 3e-12 reads as whole.
    const third = (W / 3) * (1 + 1e-12);
    expect(fitCoefficient(third, 0, W, 2)).toBe(third / W);
    // Outside the tolerance the step applies again: 3x = 1.003 floors to 1, over q = 2.
    expect(fitCoefficient((W / 3) * 1.001, 0, W, 2)).toBe(0.5);
  });

  it('an overnight launch weighs the windows it flies straight through: m - 1', () => {
    expect(fitCoefficient(0, 1, W, 2)).toBe(0);
    expect(fitCoefficient(16 * H, 2, W, 2)).toBe(1);
    expect(fitCoefficient(32 * H, 3, W, 5)).toBe(2);
  });

  it('a zero-second daytime launch weighs nothing', () => {
    expect(fitCoefficient(0, 0, W, 4)).toBe(0);
  });

  it('writes one row per distinct floor(W / seconds) among daytime classes, capped', () => {
    const seconds = [5.88 * H, 10.8 * H, 0, 1000, 100, 5.9 * H];
    const nights = [0, 0, 0, 1, 0, 0];
    expect(fitQs(seconds, nights, W)).toEqual([1, 2, FIT_Q_CAP]);
    // A launch longer than the window fits none and writes no row.
    expect(fitQs([17 * H], [0], W)).toEqual([]);
  });

  it('are only in the MILP when the problem carries a sleep window', () => {
    const problem = sleepProblem([opt(5.88), opt(0, 1)], 24 * DAY_SECONDS);
    const milpOf = (p: PlanProblem) => {
      const model = buildModel(p);
      return buildOaMilp(model, effectiveQs(model), [1], DEFAULT_TUNING.sigmaGrid);
    };
    const withSleep = milpOf(problem);
    expect(withSleep.rowNames.filter(n => n.startsWith('fit_'))).toEqual(['fit_k0_q2', 'fit_k1_q2', 'fit_k2_q2']);
    const without: PlanProblem = { ...problem, sleep: undefined };
    expect(milpOf(without).rowNames.some(n => n.startsWith('fit_'))).toBe(false);
  });
});

describe('the day schedule', () => {
  it('whole days, a partial day, and less than a day', () => {
    expect(daySchedule({ sleepSeconds: S, horizonSeconds: 24 * DAY_SECONDS }, 24 * W, 24)).toMatchObject({
      nights: 24,
      windows: 24,
      tailSeconds: 0,
    });
    expect(daySchedule({ sleepSeconds: S, horizonSeconds: 2.5 * DAY_SECONDS }, 2 * W + 12 * H, 2)).toMatchObject({
      nights: 2,
      windows: 3,
      tailSeconds: 12 * H,
    });
    expect(daySchedule({ sleepSeconds: S, horizonSeconds: 10 * H }, 10 * H, 0)).toMatchObject({
      nights: 0,
      windows: 1,
      tailSeconds: 10 * H,
    });
  });

  it('never schedules more than the horizon holds, whatever the other fields say', () => {
    const day = daySchedule({ sleepSeconds: S, horizonSeconds: 2 * DAY_SECONDS }, 10 * W, 5);
    expect(day.nights).toBe(2);
    expect(day.tailSeconds).toBe(0);
  });
});

describe('the verifier', () => {
  const sleep = { sleepSeconds: S, horizonSeconds: 2 * DAY_SECONDS };
  const at = (launchAt: number, wakingSeconds: number, nights = 0) => ({ launchAt, wakingSeconds, nights });

  it('accepts a slot that keeps the rule, bedtime launches and a landing on the horizon included', () => {
    expect(slotFault([at(0, 10 * H), at(10 * H, 6 * H), at(W, 0, 1), at(DAY_SECONDS, 16 * H)], sleep)).toBeNull();
    // Over two nights with 20 waking hours, launched at 12:00 on day 0 (4 hours before bed, 16 through day 1),
    // it lands at wake-up on day 2.
    expect(slotFault([at(12 * H, 20 * H, 2)], { sleepSeconds: S, horizonSeconds: 3 * DAY_SECONDS })).toBeNull();
    expect(slotFault([], sleep)).toBeNull();
  });

  it('rejects a launch while asleep', () => {
    expect(slotFault([at(W + 1, 0, 1)], sleep)).toMatch(/after bedtime/);
  });

  it('rejects an overlap with the previous block, overnight time included', () => {
    expect(slotFault([at(0, 10 * H), at(10 * H - 1, H)], sleep)).toMatch(/overlaps/);
    // A bedtime launch of a short ship still occupies the slot until wake-up.
    expect(slotFault([at(W, 0, 1), at(DAY_SECONDS - 1, H)], sleep)).toMatch(/overlaps/);
  });

  it('rejects a block ending past the horizon', () => {
    expect(slotFault([at(DAY_SECONDS + W, 0, 1)], sleep)).toBeNull();
    expect(slotFault([at(DAY_SECONDS + W, 1, 1)], sleep)).toMatch(/past the/);
  });

  it('allows a microsecond of float noise and no more', () => {
    expect(slotFault([at(0, 10 * H), at(10 * H - 1e-7, H)], sleep)).toBeNull();
    expect(slotFault([at(0, 10 * H), at(10 * H - 1e-5, H)], sleep)).toMatch(/overlaps/);
  });
});

describe('laying a plan out', () => {
  // Every slot's class columns as the MILP would have written them, with all launches on one group each.
  function columnsFor(problem: PlanProblem, perSlot: number[]) {
    const model = buildModel(problem);
    const layout = layoutOf(model, 'oa');
    const values = new Float64Array(layout.columnCount);
    const counts = new Array<number>(model.groups.length).fill(0);
    model.groups.forEach((grp, g) => {
      const c = layout.classOf[g];
      for (let k = 0; k < model.slots; k++) values[nCol(layout, c, k)] = perSlot[grp.members[0]];
      counts[g] = perSlot[grp.members[0]] * model.slots;
    });
    return { model, layout, values, counts };
  }
  const judgeOf = (model: ReturnType<typeof buildModel>) => (c: readonly number[]) =>
    evaluateCounts(model, c, STEERING_PRECISION).logJoint;

  it('the report case: 5.88-hour ships by day and a short ship each night fit two a day, not 65 in 24 days', async () => {
    const solve = await loadHighs();
    const problem = sleepProblem([opt(5.88), opt(0, 1)], 24 * DAY_SECONDS);
    const { model, layout, values, counts } = columnsFor(problem, [65, 24]);
    const laid = layOutPlan(model, layout, values, counts, problem.options, solve, judgeOf(model));
    expect(model.groups.map((grp, g) => [grp.members[0], laid.counts[g]]).sort()).toEqual([
      [0, 48 * 3],
      [1, 24 * 3],
    ]);
    expect(laid.stats.launchesTrimmed).toBe(17 * 3);
    expect(laid.stats.overnightTrimmed).toBe(0);
    for (const slot of laid.calendar) {
      expect(slot).toHaveLength(48 + 24);
      expect(slotFault(slot, problem.sleep!)).toBeNull();
      // Day 0: two ships, then the short one at bedtime.
      expect(hoursOf(slot.slice(0, 3))).toEqual([0, 5.88, 16]);
    }
  });

  it('a 10.8-hour daytime launch fits once per waking window', async () => {
    const solve = await loadHighs();
    const problem = sleepProblem([opt(10.8)], 10 * DAY_SECONDS);
    const { model, layout, values, counts } = columnsFor(problem, [14]);
    const laid = layOutPlan(model, layout, values, counts, problem.options, solve, judgeOf(model));
    expect(laid.counts).toEqual([30]);
    for (const slot of laid.calendar) expect(hoursOf(slot)).toEqual(Array.from({ length: 10 }, (_, d) => d * 24));
  });

  it('zero-second overnight variants go at bedtime, one a night', async () => {
    const solve = await loadHighs();
    const result = solveWith(sleepProblem([opt(0, 1)], 3 * DAY_SECONDS), solve, DEFAULT_TUNING, { report: true });
    expect(result.allocation).toEqual([9]);
    for (const slot of result.calendar!) expect(hoursOf(slot)).toEqual([16, 40, 64]);
  });

  it('less than a day (K = 0): launches end to end', async () => {
    const solve = await loadHighs();
    const result = solveWith(sleepProblem([opt(3)], 10 * H), solve, DEFAULT_TUNING);
    expect(result.allocation).toEqual([9]);
    for (const slot of result.calendar!) expect(hoursOf(slot)).toEqual([0, 3, 6]);
  });

  it('a partial trailing day holds what its own waking hours hold', async () => {
    const solve = await loadHighs();
    const problem = sleepProblem([opt(10.8)], 2.5 * DAY_SECONDS);
    const result = solveWith(problem, solve, DEFAULT_TUNING);
    expect(result.allocation).toEqual([9]);
    for (const slot of result.calendar!) expect(hoursOf(slot)).toEqual([0, 24, 48]);
  });

  it('an overnight ship can take off late and land late, around the daytime launches', async () => {
    // 20 waking hours over one night: at least 4 before bed and at most 16 after. With a 10-hour daytime ship
    // as well, a slot of 4 days holds the overnight ship each night only if each day splits around it.
    const solve = await loadHighs();
    const problem = sleepProblem([opt(20, 1, 3), opt(6, 0, 1)], 4 * DAY_SECONDS);
    const result = solveWith(problem, solve, DEFAULT_TUNING, { report: true });
    for (const slot of result.calendar!) expect(slotFault(slot, problem.sleep!)).toBeNull();
    expect(flownPerOption(result)).toEqual(result.allocation);
  });
});

describe('trimming', () => {
  it('drops the launch the judge misses least, and reports the trimmed plan', async () => {
    const solve = await loadHighs();
    // Two 10.8-hour launches in one class, neither dominating: one yields twice as much for twice the fuel.
    const problem = sleepProblem([opt(10.8, 0, 2, 2), opt(10.8, 0, 1, 1)], 10 * DAY_SECONDS);
    const model = buildModel(problem);
    const layout = layoutOf(model, 'oa');
    expect(layout.classes).toBe(1);
    const values = new Float64Array(layout.columnCount);
    for (let k = 0; k < 3; k++) values[nCol(layout, 0, k)] = 14;
    const strong = model.groups.findIndex(g => g.members[0] === 0);
    const counts = new Array<number>(model.groups.length).fill(21);
    const laid = layOutPlan(
      model,
      layout,
      values,
      counts,
      problem.options,
      solve,
      c => evaluateCounts(model, c, STEERING_PRECISION).logJoint
    );
    expect(laid.stats.launchesTrimmed).toBe(12);
    expect(laid.counts[strong]).toBe(21);
    expect(laid.counts[1 - strong]).toBe(9);
  });

  it('what the solver reports is the plan that survived the layout', async () => {
    const solve = withoutFitRows(await loadHighs());
    const problem = sleepProblem([opt(5.88), opt(0, 1)], 24 * DAY_SECONDS);
    const result = solveWith(problem, solve, DEFAULT_TUNING, { report: true });
    // The night budget alone plans 65 a slot; the layout keeps 48.
    expect(result.layoutStats!.launchesTrimmed).toBe(17 * 3);
    expect(result.allocation).toEqual([144, 72]);
    expect(flownPerOption(result)).toEqual(result.allocation);
    const model = buildModel(problem);
    const counts = model.groups.map(g => result.allocation[g.members[0]]);
    const exact = evaluateCounts(model, counts, EXACT_PRECISION).scores.map(s => -Math.expm1(-s));
    expect(result.reported!.jointProbability).toBe(exact[0]);
  });
});

describe('only verified plans leave the solver', () => {
  const problem = sleepProblem([opt(5.88), opt(0, 1)], 4 * DAY_SECONDS);
  // Lays `problem` out from slot columns holding `perOption[i]` launches of option `i` in every slot.
  function laidWith(p: PlanProblem, perOption: number[], solve: MilpSolve, verify = slotFault) {
    const model = buildModel(p);
    const layout = layoutOf(model, 'oa');
    const values = new Float64Array(layout.columnCount);
    const counts = model.groups.map(grp => perOption[grp.members[0]] * 3);
    model.groups.forEach((grp, g) => {
      for (let k = 0; k < 3; k++) values[nCol(layout, layout.classOf[g], k)] = perOption[grp.members[0]];
    });
    const laid = layOutPlan(model, layout, values, counts, p.options, solve, () => 0, verify);
    const allocation = new Array<number>(p.options.length).fill(0);
    model.groups.forEach((grp, g) => (allocation[grp.members[0]] += laid.counts[g]));
    return { laid, allocation };
  }

  it('a slot the verifier rejects is trimmed and laid out again until it passes', async () => {
    const solve = await loadHighs();
    // A verifier stricter than the real one: no more than five launches in a slot. Each slot lays out 12.
    const { laid } = laidWith(problem, [8, 4], solve, (launches, sleep) =>
      launches.length > 5 ? 'too many' : slotFault(launches, sleep)
    );
    expect(laid.stats.verifierRetries).toBe(7 * 3);
    for (const slot of laid.calendar) expect(slot).toHaveLength(5);
  });

  it('fails loudly rather than return a slot nothing makes verify', async () => {
    const solve = await loadHighs();
    expect(() => laidWith(problem, [8, 4], solve, () => 'never')).toThrow(/fails verification with nothing left/);
  });

  it('the solver refuses a calendar that breaks the rule, whoever produced it', async () => {
    const solve = await loadHighs();
    const result = solveWith(problem, solve, DEFAULT_TUNING);
    const model = buildModel(problem);
    expect(() => assertVerified(problem, model, result.allocation, result.calendar!)).not.toThrow();
    const overlap = result.calendar!.map(slot => slot.map(l => ({ ...l })));
    overlap[0][1].launchAt = overlap[0][0].launchAt + 1;
    expect(() => assertVerified(problem, model, result.allocation, overlap)).toThrow(/overlaps/);
    const miscounted = result.calendar!.map(slot => slot.slice(1));
    expect(() => assertVerified(problem, model, result.allocation, miscounted)).toThrow(/allocated/);
    const relabelled = result.calendar!.map(slot => slot.map(l => ({ ...l, wakingSeconds: 0 })));
    expect(() => assertVerified(problem, model, result.allocation, relabelled)).toThrow(/times option/);
  });

  it('a layout MILP with no incumbent falls back to the exact greedy', () => {
    const none: MilpSolve = model => ({
      status: 'unknown',
      objective: 0,
      columnValues: new Float64Array(model.columnCount),
    });
    // Ten 5.88-hour ships a slot where four days hold eight: the greedy places eight and calls the MILP.
    const { laid, allocation } = laidWith(problem, [10, 4], none);
    expect(laid.stats.layoutSolves).toBe(3);
    expect(allocation).toEqual([24, 12]);
    for (const slot of laid.calendar) expect(slotFault(slot, problem.sleep!)).toBeNull();
  });

  it('a rounded layout that over-fills a day is re-solved with the margin, then repaired', () => {
    // Every integer column at its bound: each day takes two 5.88-hour and five 3-hour ships, far over-full.
    // The margin re-solve comes back the same, so the repair runs.
    const overFull: MilpSolve = model => ({
      status: 'feasible',
      objective: 0,
      columnValues: Float64Array.from(model.columnUpper, (u, j) => (model.columnIsInteger[j] ? u : 0)),
    });
    // The longer ship yields twice as much, so neither prunes the other.
    const mixed = sleepProblem([opt(5.88, 0, 2), opt(3), opt(0, 1)], 4 * DAY_SECONDS);
    const { laid } = laidWith(mixed, [10, 10, 4], overFull);
    expect(laid.stats.marginResolves).toBe(3);
    expect(laid.stats.layoutSolves).toBe(6);
    for (const slot of laid.calendar) expect(slotFault(slot, mixed.sleep!)).toBeNull();
  });
});

describe('without a sleep window nothing changes', () => {
  it('returns no calendar and no layout statistics', async () => {
    const solve = await loadHighs();
    const problem: PlanProblem = { ...sleepProblem([opt(5.88), opt(0, 1)], 4 * DAY_SECONDS), sleep: undefined };
    const result = solveWith(problem, solve, DEFAULT_TUNING, { report: true });
    expect(result.calendar).toBeUndefined();
    expect(result.layoutStats).toBeUndefined();
    expect(Object.keys(result).sort()).toEqual(['allocation', 'craftSplit', 'reported']);
  });

  it('rejects a malformed sleep window rather than guessing', () => {
    expect(() =>
      buildModel(sleepProblem([opt(1)], DAY_SECONDS, S, { sleep: { sleepSeconds: NaN, horizonSeconds: DAY_SECONDS } }))
    ).toThrow(/sleep window/);
  });
});
