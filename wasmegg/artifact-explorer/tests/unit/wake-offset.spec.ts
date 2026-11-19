// A plan that starts some time after the player woke up (`lib/mission-optimizer/solver/SPEC.md` section 17): the
// sleep model on the player's regular day, shifted by the wake offset, from the capacity a slot has to the calendar
// the verifier passes. The arena states the same rule independently (`tests/arena/sleep.ts` and `calendar.ts`); the
// specs here hold the planner to it, and an offset of 0 to the plan without one.

import { describe, expect, it } from 'vitest';

import { optimizeFull } from 'lib/mission-optimizer/optimizer-core';
import { sinceWake } from 'lib/mission-optimizer/optimizer-views';
import { sleepCapacity, sleepVariants } from 'lib/mission-optimizer/sleep';
import {
  daySchedule,
  fitCoefficient,
  lastWakingInstant,
  leastWakingIn,
  wakingSecondsBefore,
  windowShape,
} from 'lib/mission-optimizer/solver/days';
import { loadHighs } from 'lib/mission-optimizer/solver/highs';
import { buildModel } from 'lib/mission-optimizer/solver/model';
import { buildOaMilp, effectiveQs } from 'lib/mission-optimizer/solver/milp';
import { solveWith } from 'lib/mission-optimizer/solver/solve';
import { DAY_SECONDS, normalizeProblem, type PlanProblem } from 'lib/mission-optimizer/solver/types';
import { slotFault } from 'lib/mission-optimizer/solver/verify';
import type { LaunchOption } from 'lib/mission-optimizer/types';
import { calendarFaults } from '../arena/calendar';
import { craftDag, makeOpt, makeSolution } from './spec-helpers';

const H = 3600;
const D = DAY_SECONDS;
const S = 8 * H;
const W = D - S;

// What the player sees of a launch time: the time of day since their last wake-up, and whether they are awake.
const timeOfDay = (launchAt: number, wake: number) => (((launchAt + wake) % D) + D) % D;
const awake = (launchAt: number, wake: number) => timeOfDay(launchAt, wake) <= W + 1e-6;

// A problem the way the app and the arena state one, with the waking seconds and nights the offset leaves.
function sleepProblem(options: LaunchOption[], horizon: number, wake: number, extra: Partial<PlanProblem> = {}) {
  const capacity = sleepCapacity(horizon, S, wake);
  const problem: PlanProblem = {
    options: [...sleepVariants(options, S)],
    dag: craftDag(0.1),
    targets: ['A'],
    fuelCapacity: 1e9,
    timeCapacityPerSlot: capacity.wakingSecondsPerSlot,
    nightsPerSlot: capacity.nightsPerSlot,
    sleep: { sleepSeconds: S, horizonSeconds: horizon, ...(wake > 0 && { wakeOffsetSeconds: wake }) },
    slots: 3,
    ownedStock: new Map<string, number>(),
    ...extra,
  };
  return problem;
}

describe('the wake offset at the solver boundary', () => {
  const base = sleepProblem([makeOpt(1, H, [['B', 1]])], 3 * D, 0);

  it('is left absent when absent or 0, so the problem is the one without it', () => {
    expect(normalizeProblem(base).sleep).toEqual({ sleepSeconds: S, horizonSeconds: 3 * D });
    const zero = normalizeProblem({ ...base, sleep: { ...base.sleep!, wakeOffsetSeconds: 0 } });
    expect(zero.sleep).toEqual({ sleepSeconds: S, horizonSeconds: 3 * D });
    expect('wakeOffsetSeconds' in zero.sleep!).toBe(false);
  });

  it('keeps any offset inside a day, the night included', () => {
    const at = (wakeOffsetSeconds: number) =>
      normalizeProblem({ ...base, sleep: { ...base.sleep!, wakeOffsetSeconds } }).sleep!.wakeOffsetSeconds;
    expect(at(5 * H)).toBe(5 * H);
    expect(at(W)).toBe(W);
    expect(at(20 * H)).toBe(20 * H);
  });

  it('throws on an offset that is not a time of day', () => {
    for (const wakeOffsetSeconds of [-1, NaN, Infinity, D]) {
      expect(() => normalizeProblem({ ...base, sleep: { ...base.sleep!, wakeOffsetSeconds } })).toThrow(/wake offset/);
    }
  });
});

describe('a slot that starts after wake-up', () => {
  it('is the regular day from that wake-up, its first waking hours a busy block', () => {
    const capacity = sleepCapacity(3 * D, S, 12 * H);
    const day = daySchedule(
      { sleepSeconds: S, horizonSeconds: 3 * D, wakeOffsetSeconds: 12 * H },
      capacity.wakingSecondsPerSlot,
      capacity.nightsPerSlot
    );
    expect(day).toMatchObject({ horizonSeconds: 3 * D + 12 * H, planHorizonSeconds: 3 * D, nights: 3, windows: 4 });
    // The fourth morning, up to the horizon.
    expect(day.tailSeconds).toBe(12 * H);
    // Without an offset, the same schedule the day had before the field existed.
    const plain = daySchedule({ sleepSeconds: S, horizonSeconds: 3 * D }, 48 * H, 3);
    expect(plain).toEqual({
      sleepSeconds: S,
      wakingSeconds: W,
      horizonSeconds: 3 * D,
      planHorizonSeconds: 3 * D,
      wakeOffsetSeconds: 0,
      firstNightSeconds: 0,
      nights: 3,
      windows: 3,
      tailSeconds: 0,
    });
  });

  it('reads the 2x window on the regular day, less the busy block', () => {
    // Twelve hours awake and six hours of window: it closes in the night, so its last waking instant is bedtime,
    // four hours in.
    expect(windowShape(6 * H, W, 12 * H)).toEqual({ latest: W, nights: 0, waking: 4 * H, partial: W });
    // Across the first night: the next morning's six hours as well.
    expect(windowShape(18 * H, W, 12 * H)).toEqual({ latest: D + 6 * H, nights: 1, waking: 10 * H, partial: 6 * H });
    expect(windowShape(18 * H, W, 0)).toEqual(windowShape(18 * H, W));
  });

  it('charges a doubled block the least it holds starting anywhere the plan and the window allow', () => {
    // Brute force over starts on a one-minute grid against the breakpoint search.
    for (const wake of [0, 3 * H, 12 * H, W]) {
      for (const block of [0, 30 * 60, 5 * H, 10 * H, 20 * H, 40 * H]) {
        for (const window of [H, 10 * H, 30 * H]) {
          const latest = lastWakingInstant(window + wake, W);
          let least = Infinity;
          for (let t = wake; t <= latest; t += 60) {
            if (t - Math.floor(t / D) * D > W) continue;
            least = Math.min(least, wakingSecondsBefore(t + block, W) - wakingSecondsBefore(t, W));
          }
          least = Math.min(least, wakingSecondsBefore(latest + block, W) - wakingSecondsBefore(latest, W));
          expect(leastWakingIn(block, latest, W, wake)).toBeCloseTo(least, 6);
        }
      }
    }
  });

  it('gives the busy block its share of every fit row, and none at an offset of 0', () => {
    const options = [makeOpt(1, 5 * H, [['B', 1]]), makeOpt(1, 3 * H, [['B', 0.5]])];
    const rows = (wake: number) => {
      const model = buildModel(sleepProblem(options, 3 * D, wake));
      const milp = buildOaMilp(
        model,
        effectiveQs(model),
        model.sortedTargets.map(() => 1),
        [1, 0.1]
      );
      return milp.rowNames.flatMap((name, r) =>
        name.startsWith('fit_') ? [[name, milp.rowUpper[r], Number(name.split('_q')[1])] as const] : []
      );
    };
    const plain = rows(0);
    expect(plain.length).toBeGreaterThan(0);
    for (const [, upper] of plain) expect(upper).toBe(3);
    const busy = rows(4 * H);
    expect(busy.map(([name]) => name)).toEqual(plain.map(([name]) => name));
    for (const [, upper, q] of busy) expect(upper).toBeCloseTo(4 - fitCoefficient(4 * H, 0, W, q), 12);
  });
});

describe('the verifier with a wake offset', () => {
  const sleep = { sleepSeconds: S, horizonSeconds: 2 * D, wakeOffsetSeconds: 12 * H };
  const at = (launchAt: number, wakingSeconds = H, nights = 0) => ({ launchAt, wakingSeconds, nights });

  it('accepts what is left of the first day and the next wake-up', () => {
    expect(slotFault([at(0), at(3 * H), at(12 * H), at(D)], sleep)).toBeNull();
    // A bedtime launch, four hours in, through the night it flies to the next wake-up.
    expect(slotFault([at(4 * H, 0, 1), at(12 * H)], sleep)).toBeNull();
  });

  it('rejects a launch in the shifted night, and one before the plan starts', () => {
    expect(slotFault([at(5 * H)], sleep)).toMatch(/after bedtime/);
    expect(slotFault([at(11 * H)], sleep)).toMatch(/after bedtime/);
    expect(slotFault([at(5 * H)], { sleepSeconds: S, horizonSeconds: 2 * D })).toBeNull();
    expect(slotFault([at(-1)], sleep)).toMatch(/before the plan starts/);
    // The horizon is the plan's own: the last block ends by it.
    expect(slotFault([at(2 * D - H + 1)], sleep)).toMatch(/past the/);
  });

  it('agrees with the arena on random calendars', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let trial = 0; trial < 400; trial++) {
      const sleepSeconds = [4, 8, 12][trial % 3] * H;
      // Awake at the start, and in the night, where only T+0 may launch.
      const wake = Math.floor(rand() * D);
      const firstNight = wake > D - sleepSeconds ? D - wake : 0;
      const horizon = (1 + Math.floor(rand() * 4)) * D;
      let free = rand() < 0.1 ? -600 : 0;
      const launches: { launchAt: number; wakingSeconds: number; nights: number; atStartSeconds?: number }[] = [];
      for (let i = 0; i < 1 + Math.floor(rand() * 6); i++) {
        // Sometimes a launch at T+0, of a T+0 variant or not, and sometimes one just after it.
        const pick = rand();
        const launchAt = i === 0 && pick < 0.3 ? 0 : i === 0 && pick < 0.4 ? 60 : Math.round(free + rand() * 6 * H);
        const nights = rand() < 0.3 ? 1 + Math.floor(rand() * 2) : 0;
        const wakingSeconds = Math.round(rand() * 20 * H);
        const atStartSeconds = rand() < 0.4 ? Math.round(firstNight + rand() * 30 * H) : undefined;
        launches.push({ launchAt, wakingSeconds, nights, ...(atStartSeconds !== undefined && { atStartSeconds }) });
        free = launchAt + (atStartSeconds ?? wakingSeconds + nights * sleepSeconds) - (rand() < 0.1 ? 600 : 0);
      }
      const planner = slotFault(launches, { sleepSeconds, horizonSeconds: horizon, wakeOffsetSeconds: wake });
      const menu = launches.map((l, i) => ({
        id: `o${i}`,
        actualTime: l.wakingSeconds,
        nights: l.nights,
        ...(l.atStartSeconds !== undefined && { atStartSeconds: l.atStartSeconds }),
      }));
      const calendar = [launches.map((l, i) => ({ option: i, optionId: `o${i}`, launchAt: l.launchAt }))];
      const arena = calendarFaults(
        calendar,
        menu,
        menu.map(() => 1),
        {
          sleepSeconds,
          horizonSeconds: horizon,
          slots: 1,
          wakeOffsetSeconds: wake,
        }
      );
      expect(planner === null, `${planner} / ${arena.join('; ')}`).toBe(arena.length === 0);
    }
  });
});

describe('optimizeFull with a wake offset', () => {
  // One-hour launches of a leaf the target is crafted from: the more, the better, so a plan is as many as the days
  // hold, and where they go is the calendar the offset makes.
  const args = (horizon: number) => ({
    options: [makeOpt(1, H, [['B', 1]])],
    recipeDag: craftDag(0.1),
    desiredArtifactNodeIds: ['A'],
    fuelCapacity: 1e9,
    timeCapacityPerSlot: horizon,
    ownedStock: new Map<string, number>(),
    maximumCost: undefined,
    sleepSeconds: S,
  });
  const launched = (choices: { nights?: number; numShipsLaunched: number }[], overnight: boolean) =>
    choices.filter(c => (c.nights ?? 0) > 0 === overnight).reduce((n, c) => n + c.numShipsLaunched, 0);

  it('is the plan without one at an offset of 0, and ignores one without sleep', async () => {
    const plain = await optimizeFull(args(3 * D));
    expect(plain.wakeOffsetSeconds).toBeUndefined();
    expect(await optimizeFull({ ...args(3 * D), wakeOffsetSeconds: 0 })).toEqual(plain);
    const around = await optimizeFull({ ...args(3 * D), sleepSeconds: undefined });
    expect(await optimizeFull({ ...args(3 * D), sleepSeconds: undefined, wakeOffsetSeconds: 5 * H })).toEqual(around);
  });

  it('fills what is left of the first day, every later day, and the last morning, from the start on', async () => {
    const wake = 4 * H;
    const plan = await optimizeFull({ ...args(3 * D), wakeOffsetSeconds: wake });
    expect(plan.wakeOffsetSeconds).toBe(wake);
    // 12 + 16 + 16 + 4 one-hour launches and three bedtime launches per slot.
    expect(launched(plan.choiceHistory, false)).toBe(3 * 48);
    expect(launched(plan.choiceHistory, true)).toBe(3 * 3);
    for (const slot of plan.slots!) {
      expect(slot.launches[0].launchAt).toBe(0);
      for (const l of slot.launches) {
        expect(l.launchAt).toBeGreaterThanOrEqual(0);
        expect(awake(l.launchAt, wake)).toBe(true);
      }
      // The bedtimes, 12 hours in and a day apart after, are where the night launches go.
      const nights = slot.launches.filter(l => (l.nights ?? 0) > 0).map(l => l.launchAt);
      expect(nights).toEqual([12 * H, 12 * H + D, 12 * H + 2 * D]);
      expect(slot.loadSeconds).toBe(3 * D);
    }
    expect(plan.timeUnitsUsed).toBe(3 * D);
  });

  it('starts at bedtime with the night, and launches nothing awake before the next wake-up', async () => {
    const plan = await optimizeFull({ ...args(3 * D), wakeOffsetSeconds: W });
    expect(launched(plan.choiceHistory, false)).toBe(3 * 48);
    expect(launched(plan.choiceHistory, true)).toBe(3 * 3);
    for (const slot of plan.slots!) {
      expect(slot.launches[0]).toMatchObject({ launchAt: 0, nights: 1 });
      expect(slot.launches[1].launchAt).toBe(S);
      for (const l of slot.launches) expect(awake(l.launchAt, W)).toBe(true);
    }
  });

  it('holds a doubled launch inside the 2x window it composes with, on the shifted day', async () => {
    // Twelve hours awake and six of 2x left: bedtime comes four hours in, so the window's doubled launches are the
    // first four hours' and the bedtime one.
    const wake = 12 * H;
    const plan = await optimizeFull({ ...args(3 * D), wakeOffsetSeconds: wake, eventWindowSeconds: 6 * H });
    expect(plan.eventWindowSeconds).toBe(6 * H);
    for (const slot of plan.slots!) {
      for (const l of slot.launches) {
        const doubled = (plan.choiceHistory[l.choice].variant ?? 'normal') !== 'normal';
        expect(awake(l.launchAt, wake)).toBe(true);
        expect(doubled).toBe(l.launchAt <= 6 * H);
      }
      expect(slot.launches.filter(l => l.launchAt <= 6 * H)).toHaveLength(5);
    }
  });
});

describe('optimizeFull with the plan starting in the night', () => {
  // Twenty hours awake: four hours of night left, so the first wake-up comes 4 hours in and bedtime 20 hours in.
  const wake = 20 * H;
  const args = (horizon: number, hours = 1) => ({
    options: [makeOpt(1, hours * H, [['B', 1]])],
    recipeDag: craftDag(0.1),
    desiredArtifactNodeIds: ['A'],
    fuelCapacity: 1e9,
    timeCapacityPerSlot: horizon,
    ownedStock: new Map<string, number>(),
    maximumCost: undefined,
    sleepSeconds: S,
    wakeOffsetSeconds: wake,
  });

  it('launches once a slot at T+0 and nothing more until the wake-up, then fills the days from it', async () => {
    const plan = await optimizeFull(args(3 * D));
    expect(plan.wakeOffsetSeconds).toBe(wake);
    for (const slot of plan.slots!) {
      const [first, second] = slot.launches;
      expect(first.launchAt).toBe(0);
      expect(plan.choiceHistory[first.choice].atStartSeconds).toBe(H);
      // Back an hour later, while the player sleeps: still a launch they see in the air through that night.
      expect(first.nights).toBe(1);
      expect(second.launchAt).toBe(4 * H);
      for (const l of slot.launches.slice(1)) expect(awake(l.launchAt, wake)).toBe(true);
      // 16 + 16 + 16 waking hours after the wake-up, the T+0 launch, and a bedtime launch each of the two whole
      // nights.
      expect(slot.launches).toHaveLength(1 + 48 + 2);
    }
  });

  it('charges a ship sent at T+0 only for what it holds after the wake-up', async () => {
    // A 10-hour ship sent at T+0 lands 6 hours after the wake-up: the slot has 10 of that day's waking hours left,
    // ten one-hour launches it is too long to fit, so each slot flies one at T+0 and three days of 10-hour ships.
    const plan = await optimizeFull(args(3 * D, 10));
    for (const slot of plan.slots!) {
      expect(slot.launches[0].launchAt).toBe(0);
      expect(slot.launches[1].launchAt).toBe(10 * H);
    }
  });

  it('flies only its T+0 launches doubled under a 2x window that closes before the wake-up', async () => {
    const plan = await optimizeFull({ ...args(3 * D), eventWindowSeconds: 2 * H });
    for (const slot of plan.slots!) {
      slot.launches.forEach((l, i) => {
        expect((plan.choiceHistory[l.choice].variant ?? 'normal') !== 'normal').toBe(i === 0);
      });
    }
  });
});

describe('the solver with a wake offset', () => {
  it('lays nothing out before the plan starts, and the busy block first in every slot', async () => {
    const solve = await loadHighs();
    // A 10-hour daytime ship at Low effort's floor would not fit the 4 hours left; at Max it flies from the start
    // into the night.
    const options = [makeOpt(1, 10 * H, [['B', 1]]), makeOpt(1, 2 * H, [['B', 0.3]])];
    const wake = 12 * H;
    const problem = sleepProblem(options, 2 * D, wake);
    const result = solveWith(problem, solve);
    expect(result.calendar!.flat().length).toBeGreaterThan(0);
    for (const slot of result.calendar!) {
      for (const l of slot) {
        expect(l.launchAt).toBeGreaterThanOrEqual(0);
        expect(awake(l.launchAt, wake)).toBe(true);
      }
    }
    // What goes first goes at the plan's start, the busy block's end on the regular day.
    expect(result.calendar!.some(slot => slot[0]?.launchAt === 0)).toBe(true);
  });

  it('solves an offset of 0 to the plan without one, matrix and calendar alike', async () => {
    const solve = await loadHighs();
    const options = [makeOpt(1, 10 * H, [['B', 1]]), makeOpt(1, 2 * H, [['B', 0.3]]), makeOpt(1, 20 * H, [['B', 2]])];
    const plain = sleepProblem(options, 4 * D, 0, { eventWindowSeconds: 30 * H });
    const zero = { ...plain, sleep: { ...plain.sleep!, wakeOffsetSeconds: 0 } };
    expect(buildModel(zero)).toEqual(buildModel(plain));
    const model = buildModel(plain);
    const grid = [1, 0.5, 0.1, 0.01];
    const theta = model.sortedTargets.map(() => 1);
    expect(buildOaMilp(buildModel(zero), effectiveQs(model), theta, grid)).toEqual(
      buildOaMilp(model, effectiveQs(model), theta, grid)
    );
    expect(solveWith(zero, solve, undefined, { report: true })).toEqual(
      solveWith(plain, solve, undefined, { report: true })
    );
  });
});

describe('the timeline with a wake offset', () => {
  it('counts days from the player’s wake-ups', () => {
    const solution = makeSolution({ sleepSeconds: S, wakeOffsetSeconds: 12 * H });
    expect(Math.floor(sinceWake(solution, 11 * H) / D)).toBe(0);
    expect(Math.floor(sinceWake(solution, 12 * H) / D)).toBe(1);
    expect(sinceWake(makeSolution({ sleepSeconds: S }), 11 * H)).toBe(11 * H);
  });
});
