// What a solve does when HiGHS fails outright on the plan's MILP (`lib/mission-optimizer/solver/SPEC.md` sections 8
// and 16): one retry with presolve on, and, with a 2x window, the same problem without the window flown under it,
// so the window never does worse than no window. The arena's seed 2030 with a window straddling the horizon is the
// case that came back empty.

import { describe, expect, it } from 'vitest';
import { capacityVariants } from 'lib/mission-optimizer/capacity';
import { loadHighs } from 'lib/mission-optimizer/solver/highs';
import { DEFAULT_TUNING, solveWith } from 'lib/mission-optimizer/solver/solve';
import type { MilpLimits, MilpModel, MilpSolve, PlanProblem } from 'lib/mission-optimizer/solver/types';
import type { LaunchOption } from 'lib/mission-optimizer/types';
import { calendarFaults } from '../arena/calendar';
import { run } from '../arena/harness';
import { EVENT_REGIMES, generateInstance } from '../arena/instances';
import { highs } from '../arena/solvers/highs';
import { craftDag, makeOpt } from './spec-helpers';

const H = 3600;

// The plan's MILP is the one with tangent cuts; the scale LPs and the layout's MILPs have none.
const isPlanMilp = (model: MilpModel) => model.rowNames.some(name => name.startsWith('cut_t'));
const hasWindow = (model: MilpModel) => model.rowNames.some(name => name.startsWith('overhang_k'));

// HiGHS as it fails out of `Highs_run`: no status, no incumbent.
const failed = (model: MilpModel) => ({
  status: 'unknown' as const,
  objective: 0,
  columnValues: new Float64Array(model.columnCount),
});

function problemOf(options: LaunchOption[], window?: number): PlanProblem {
  return {
    options: window ? [...capacityVariants(options, window)] : options,
    dag: craftDag(0.05),
    targets: ['A'],
    fuelCapacity: 12,
    timeCapacityPerSlot: 10 * H,
    ...(window && { eventWindowSeconds: window }),
    slots: 3,
    ownedStock: new Map(),
  };
}

const menu = () => [makeOpt(1, 2 * H, [['B', 1]]), makeOpt(2, 3 * H, [['B', 3]])];

describe('a plan MILP HiGHS fails on', () => {
  it('is solved again once, with presolve on, and that answer is the plan', async () => {
    const solve = await loadHighs();
    const retries: MilpLimits[] = [];
    let failedOnce = false;
    const flaky: MilpSolve = (model, limits) => {
      if (isPlanMilp(model) && !failedOnce) {
        failedOnce = true;
        return failed(model);
      }
      if (isPlanMilp(model)) retries.push(limits);
      return solve(model, limits);
    };
    const problem = problemOf(menu(), 4 * H);
    const result = solveWith(problem, flaky, DEFAULT_TUNING, { report: true });
    expect(retries).toEqual([expect.objectContaining({ retry: true })]);
    const reference = solveWith(problem, solve, DEFAULT_TUNING, { report: true });
    expect(result.reported!.jointProbability).toBeGreaterThanOrEqual(reference.reported!.jointProbability * (1 - 1e-9));
  });

  it('with a window, falls back on the plan without it, flown under the window, never worse', async () => {
    const solve = await loadHighs();
    // Every plan MILP carrying the window fails, retry included; the windowless one solves.
    const broken: MilpSolve = (model, limits) =>
      isPlanMilp(model) && hasWindow(model) ? failed(model) : solve(model, limits);
    const window = 4 * H;
    const problem = problemOf(menu(), window);
    const result = solveWith(problem, broken, DEFAULT_TUNING, { report: true });
    const plain = solveWith(problemOf(menu()), solve, DEFAULT_TUNING, { report: true });
    expect(result.allocation.some(n => n > 0)).toBe(true);
    expect(result.reported!.jointProbability).toBeGreaterThan(plain.reported!.jointProbability);
    const day = { sleepSeconds: 0, horizonSeconds: 10 * H, slots: 3, eventWindowSeconds: window };
    expect(calendarFaults(result.calendar, problem.options, result.allocation, day)).toEqual([]);
    // Whatever goes up inside the window flies doubled; the windowless plan's launches are the ones flown.
    for (const slot of result.calendar!) for (const l of slot) expect(l.doubled).toBe(l.launchAt <= window);
    expect(result.calendar!.flat().length).toBe(plain.calendar!.flat().length);
  });

  it('without a window, still comes back empty when the retry fails too', async () => {
    const solve = await loadHighs();
    const broken: MilpSolve = (model, limits) => (isPlanMilp(model) ? failed(model) : solve(model, limits));
    const result = solveWith(problemOf(menu()), broken, DEFAULT_TUNING);
    expect(result.allocation).toEqual([0, 0]);
    expect(result.calendar).toEqual([[], [], []]);
  });
});

describe('arena seed 2030 with a 2x window straddling the horizon', () => {
  // HiGHS threw "error -1" out of `Highs_run` on this plan MILP with presolve off, and the solve came back empty,
  // though the same seed without the window has a plan.
  it('has a plan at least as good as the one without the window', () => {
    const drawn = generateInstance(2030);
    const instance = { ...drawn, sleepSeconds: 0 };
    const window = EVENT_REGIMES['straddle-under'](instance);
    const windowed = run(highs.plan, { ...instance, eventWindowSeconds: window });
    const plain = run(highs.plan, { ...instance, eventWindowSeconds: 0 });
    expect(windowed.allocation.some(n => n > 0)).toBe(true);
    expect(plain.joint).toBeGreaterThan(0);
    expect(windowed.joint).toBeGreaterThanOrEqual(plain.joint);
  }, 300_000);
});
