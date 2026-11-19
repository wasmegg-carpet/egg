// The 2x window both ways: a launch is doubled if and only if it goes up inside the window, so the layout flies
// doubled every 1x launch it finds there (`lib/mission-optimizer/solver/SPEC.md` section 16). The fuzz is the
// review's probe, cut to a size the unit suite can afford, and judged by the arena's own calendar checker and
// labelled packer rather than by anything the solver shares.

import { describe, expect, it } from 'vitest';
import { capacityVariants } from 'lib/mission-optimizer/capacity';
import { sleepCapacity, sleepVariants } from 'lib/mission-optimizer/sleep';
import { STEERING_PRECISION, evaluateCounts } from 'lib/mission-optimizer/solver/evaluator';
import { loadHighs } from 'lib/mission-optimizer/solver/highs';
import { buildModel } from 'lib/mission-optimizer/solver/model';
import { DEFAULT_TUNING, solveWith } from 'lib/mission-optimizer/solver/solve';
import { DAY_SECONDS, type PlanProblem } from 'lib/mission-optimizer/solver/types';
import type { LaunchOption } from 'lib/mission-optimizer/types';
import { calendarFaults } from '../arena/calendar';
import { feasible } from '../arena/harness';
import { craftDag, makeOpt } from './spec-helpers';

const H = 3600;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function problemFor(
  base: LaunchOption[],
  horizon: number,
  sleep: number,
  window: number,
  fuel: number,
  pCraft: number
) {
  const options = [...capacityVariants(sleep > 0 ? sleepVariants(base, sleep) : base, window)];
  const cap = sleep > 0 ? sleepCapacity(horizon, sleep) : null;
  const problem: PlanProblem = {
    options,
    dag: craftDag(pCraft),
    targets: ['A'],
    fuelCapacity: fuel,
    timeCapacityPerSlot: cap ? cap.wakingSecondsPerSlot : horizon,
    ...(cap && { nightsPerSlot: cap.nightsPerSlot, sleep: { sleepSeconds: sleep, horizonSeconds: horizon } }),
    ...(window > 0 && { eventWindowSeconds: window }),
    slots: 3,
    ownedStock: new Map(),
  };
  return problem;
}

const dayOf = (sleep: number, horizon: number, window: number) => ({
  sleepSeconds: sleep,
  horizonSeconds: horizon,
  slots: 3,
  eventWindowSeconds: window,
});

describe('a 1x launch inside the 2x window is flown doubled', () => {
  // Review repro: a 48-hour window over a 12-hour horizon. The objective saturates, so the MILP was indifferent
  // and left one slot of eleven 6-minute launches at 1x while the others flew the same launches doubled.
  it('doubles every launch of a plan the window covers whole', async () => {
    const solve = await loadHighs();
    const problem = problemFor([makeOpt(1, 0.1 * H, [['B', 4]])], 12 * H, 0, 48 * H, 33, 0.1);
    const result = solveWith(problem, solve, DEFAULT_TUNING, { report: true });
    expect(calendarFaults(result.calendar, problem.options, result.allocation, dayOf(0, 12 * H, 48 * H))).toEqual([]);
    const launches = result.calendar!.flat();
    expect(launches.length).toBe(33);
    expect(launches.every(l => l.doubled)).toBe(true);
    // One overhang a slot, the slot's last launch inside the window; the rest are event launches.
    for (const slot of result.calendar!) {
      const variants = slot.map(l => problem.options[l.option].variant);
      expect(variants.slice(0, -1).every(v => v === 'event')).toBe(true);
      expect(variants.at(-1)).toBe('overhang');
    }
    expect(feasible(problem, result.allocation)).toBe(true);
  });

  it('leaves nothing 1x inside the window, sleep or not; the calendar verifies and the plan packs', async () => {
    const solve = await loadHighs();
    const rnd = mulberry32(999);
    let promoted = 0;
    let checkedMonotone = 0;
    for (let n = 0; n < 36; n++) {
      const regime = n % 2 === 0 ? 'window' : 'sleep+window';
      const base: LaunchOption[] = [];
      for (let i = 0, count = 2 + Math.floor(rnd() * 3); i < count; i++) {
        const hours = [0.1, 0.5, 1, 2, 3, 4, 5.88, 8, 10.8, 13, 20, 30][Math.floor(rnd() * 12)];
        base.push(makeOpt(1 + Math.floor(rnd() * 3), hours * H, [['B', 1 + Math.floor(rnd() * 4)]]));
      }
      const sleep = regime === 'window' ? 0 : [6, 8, 10, 12][Math.floor(rnd() * 4)] * H;
      const window = [0.5, 1, 6, 16, 20, 30, 48][Math.floor(rnd() * 7)] * H;
      const horizon = [0.5, 1, 2, 3][Math.floor(rnd() * 4)] * DAY_SECONDS;
      const fuel = 5 + Math.floor(rnd() * 50);
      const problem = problemFor(base, horizon, sleep, window, fuel, [0.005, 0.02, 0.1][Math.floor(rnd() * 3)]);
      const result = solveWith(problem, solve, DEFAULT_TUNING, { report: true });
      const day = dayOf(sleep, sleep > 0 ? horizon : problem.timeCapacityPerSlot, window);
      expect(calendarFaults(result.calendar, problem.options, result.allocation, day), `instance ${n}`).toEqual([]);
      for (const slot of result.calendar!)
        for (const l of slot) if (l.launchAt < window - 1e-6) expect(l.doubled, `instance ${n}`).toBe(true);
      // The arena's labelled packer (what D1, D2 and M3 test moves with) accepts the promoted labels.
      expect(feasible(problem, result.allocation), `instance ${n}`).toBe(true);
      // Promotion only raises the joint: with nothing trimmed or demoted, what is delivered is at least what the MILP
      // promised.
      const stats = result.layoutStats;
      if (stats) {
        promoted += stats.launchesPromoted ?? 0;
        if (stats.launchesTrimmed === 0 && stats.launchesDemoted === 0 && stats.plannedLogJoint !== undefined) {
          const model = buildModel(problem);
          const counts = model.groups.map(g => result.allocation[g.members[0]]);
          expect(evaluateCounts(model, counts, STEERING_PRECISION).logJoint).toBeGreaterThanOrEqual(
            stats.plannedLogJoint - 1e-9
          );
          checkedMonotone++;
        }
      }
    }
    expect(promoted).toBeGreaterThan(0);
    expect(checkedMonotone).toBeGreaterThan(0);
  }, 600_000);
});
