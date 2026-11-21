// The fueling pad (`lib/mission-optimizer/solver/SPEC.md` section 18): one pad for every slot, empty at T+0, fuelling
// one ship at a time for its fuel over the rate, so in launch order each launch goes up at least its own fuelling
// after the one before it. The arena states the same rule independently (`tests/arena/calendar.ts`); the specs here
// hold the planner's verifier to it, the solver's calendars to the rule in every regime, and a problem without a rate
// to the one it was.

import { describe, expect, it } from 'vitest';

import { optimizeFull } from 'lib/mission-optimizer/optimizer-core';
import { fuelTankOutputsPerMinute, fuelTankSizes } from 'lib';
import { fuelingRateOfLevel } from 'lib/mission-optimizer/fueling';
import { capacityVariants } from 'lib/mission-optimizer/capacity';
import { sleepCapacity, sleepVariants, startVariants } from 'lib/mission-optimizer/sleep';
import { loadHighs } from 'lib/mission-optimizer/solver/highs';
import { buildModel } from 'lib/mission-optimizer/solver/model';
import { buildOaMilp, effectiveQs, layoutOf } from 'lib/mission-optimizer/solver/milp';
import { solveWith } from 'lib/mission-optimizer/solver/solve';
import {
  DAY_SECONDS,
  normalizeProblem,
  padSecondsOf,
  type CalendarLaunch,
  type PlanProblem,
} from 'lib/mission-optimizer/solver/types';
import { padFault, slotFault, startChain } from 'lib/mission-optimizer/solver/verify';
import type { LaunchOption } from 'lib/mission-optimizer/types';
import { calendarFaults } from '../arena/calendar';
import { PAD_EGGS_PER_MINUTE } from '../arena/instances';
import { craftDag, makeOpt } from './spec-helpers';

const M = 60;
const H = 3600;
const D = DAY_SECONDS;
const S = 8 * H;
const W = D - S;

// A pad moving one egg a second, so an option's fuel is its fuelling in seconds.
const RATE = 1;

function problemOf(options: LaunchOption[], horizon: number, extra: Partial<PlanProblem> = {}): PlanProblem {
  return {
    options,
    dag: craftDag(0.1),
    targets: ['A'],
    fuelCapacity: 1e9,
    timeCapacityPerSlot: horizon,
    slots: 3,
    ownedStock: new Map<string, number>(),
    fuelingRate: RATE,
    ...extra,
  };
}

// The same problem the way the app and the arena state one with a sleep window (and a wake offset, and a window).
function sleepProblem(
  options: LaunchOption[],
  horizon: number,
  wake: number,
  extra: Partial<PlanProblem> = {}
): PlanProblem {
  const capacity = sleepCapacity(horizon, S, wake);
  const window = extra.eventWindowSeconds ?? 0;
  return problemOf(
    [...capacityVariants([...sleepVariants(options, S), ...startVariants(options, S, wake, horizon)], window)],
    capacity.wakingSecondsPerSlot,
    {
      nightsPerSlot: capacity.nightsPerSlot,
      sleep: { sleepSeconds: S, horizonSeconds: horizon, ...(wake > 0 && { wakeOffsetSeconds: wake }) },
      ...extra,
    }
  );
}

// Every launch of a calendar in launch order, with its fuelling, for the checks below.
function padOrder(problem: PlanProblem, calendar: CalendarLaunch[][]) {
  return calendar
    .flatMap(launches =>
      launches.map(l => ({ at: l.launchAt, pad: padSecondsOf(problem.options[l.option], problem.fuelingRate) }))
    )
    .sort((a, b) => a.at - b.at || b.pad - a.pad);
}

// The arena's verdict on a solver's plan, from its own statement of the day.
function arenaFaults(problem: PlanProblem, calendar: CalendarLaunch[][], allocation: number[]) {
  return calendarFaults(calendar, problem.options, allocation, {
    sleepSeconds: problem.sleep?.sleepSeconds ?? 0,
    horizonSeconds: problem.sleep?.horizonSeconds ?? problem.timeCapacityPerSlot,
    slots: problem.slots,
    eventWindowSeconds: problem.eventWindowSeconds ?? 0,
    ...(problem.sleep?.wakeOffsetSeconds !== undefined && { wakeOffsetSeconds: problem.sleep.wakeOffsetSeconds }),
    ...(problem.fuelingRate !== undefined && { fuelingRate: problem.fuelingRate }),
  });
}

describe('the fueling rate', () => {
  it('moves its tank level’s output, a full tank in 6.67 to 55.56 minutes, 9T a minute at the 500T tank', () => {
    expect(fuelingRateOfLevel(7)! * 60).toBe(9e12);
    expect(fuelingRateOfLevel(3)! * 60).toBe(3e12);
    const fullTankMinutes = fuelTankSizes.map((size, level) => size / fuelingRateOfLevel(level)! / 60);
    [6.67, 16.67, 55.56, 33.33, 44.44, 50, 53.33, 55.56].forEach((minutes, level) =>
      expect(fullTankMinutes[level]).toBeCloseTo(minutes, 2)
    );
    expect(fuelTankOutputsPerMinute).toHaveLength(fuelTankSizes.length);
    for (const level of [-1, 8, 2.5]) expect(fuelingRateOfLevel(level)).toBeUndefined();
  });

  it('is the table the arena states on its own', () => {
    expect(PAD_EGGS_PER_MINUTE).toEqual(fuelTankOutputsPerMinute);
  });

  it('fuels a launch for all its eggs at one rate, a doubled one as long as its 1x twin', () => {
    expect(padSecondsOf({ actualFuel: 600 }, 2)).toBe(300);
    expect(padSecondsOf({ actualFuel: 600 }, undefined)).toBe(0);
    const [normal, , overhang] = capacityVariants([makeOpt(600, H, [['B', 1]])], 2 * H);
    expect(padSecondsOf(overhang, 2)).toBe(padSecondsOf(normal, 2));
  });

  it('is left absent when absent and refused when it fuels nothing or in no time', () => {
    const base: PlanProblem = { ...problemOf([makeOpt(1, H, [['B', 1]])], D) };
    delete (base as { fuelingRate?: number }).fuelingRate;
    expect('fuelingRate' in normalizeProblem(base)).toBe(false);
    expect(normalizeProblem({ ...base, fuelingRate: 3 }).fuelingRate).toBe(3);
    for (const bad of [0, -1, NaN, Infinity]) expect(() => normalizeProblem({ ...base, fuelingRate: bad })).toThrow();
  });
});

describe('the verifier with the fueling pad', () => {
  const pad = (launchAt: number, padSeconds: number) => ({ launchAt, padSeconds });

  it('rejects launches sent together, and the first one before its own fuelling', () => {
    expect(padFault([[pad(0, 0)], [pad(0, 0)], [pad(0, 0)]])).toBeNull();
    expect(padFault([[pad(600, 600)], [pad(600, 300)], []])).toMatch(/fueling pad/);
    expect(padFault([[pad(599, 600)], [], []])).toMatch(/fueling pad/);
    expect(padFault([[pad(600, 600)], [pad(900, 300)], [pad(1500, 600)]])).toBeNull();
  });

  it('starts fuelling the next ship the moment one goes up, while every slot still flies', () => {
    // Slot 0 lands at 4h; its next ship was fuelled in the meantime and goes up at once.
    expect(padFault([[pad(600, 600), pad(600 + 4 * H, 600)], [pad(900, 300)], []])).toBeNull();
  });

  it('reads the start chain off launch times, back to back on the pad from T+0', () => {
    expect(startChain([[pad(600, 600)], [pad(900, 300)], [pad(1500, 600)]])).toEqual([[true], [true], [true]]);
    // A second idle before the third ends it there.
    expect(startChain([[pad(600, 600)], [pad(900, 300)], [pad(1501, 600)]])).toEqual([[true], [true], [false]]);
    // Without the pad, the launches at T+0 itself.
    expect(startChain([[pad(0, 0), pad(60, 0)], [pad(0, 0)]])).toEqual([[true, false], [true]]);
  });

  it('admits the chain in the night the plan starts in, and past a bedtime the pad carries it over', () => {
    const night = { sleepSeconds: S, horizonSeconds: 2 * D, wakeOffsetSeconds: 20 * H };
    const ship = (launchAt: number, startChained?: boolean) => ({
      launchAt,
      wakingSeconds: H,
      nights: 0,
      ...(startChained !== undefined && { startChain: startChained }),
    });
    expect(slotFault([ship(600, true)], night)).toBeNull();
    expect(slotFault([ship(600, false)], night)).toMatch(/after bedtime/);
    // Without the field the chain is T+0 itself, as it always was.
    expect(slotFault([ship(0)], night)).toBeNull();
    expect(slotFault([ship(600)], night)).toMatch(/after bedtime/);
    // At bedtime, awake by the rules without the pad: a chain the pad carries past it stays admitted.
    const bedtime = { ...night, wakeOffsetSeconds: W };
    expect(slotFault([ship(600, true)], bedtime)).toBeNull();
    expect(slotFault([ship(600, false)], bedtime)).toMatch(/after bedtime/);
  });

  it('agrees with the arena on random calendars across slots', () => {
    let seed = 11;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let trial = 0; trial < 400; trial++) {
      const sleepSeconds = [0, 8 * H, 12 * H][trial % 3];
      const wake = sleepSeconds > 0 && rand() < 0.5 ? Math.floor(rand() * D) : 0;
      const firstNight = sleepSeconds > 0 && wake > D - sleepSeconds ? D - wake : 0;
      const horizon = (1 + Math.floor(rand() * 3)) * D;
      const menu: { id: string; actualTime: number; nights: number; actualFuel: number; atStartSeconds?: number }[] =
        [];
      const slots: { option: number; optionId: string; launchAt: number }[][] = [[], [], []];
      // Built along the pad, so that many calendars land exactly on its rule and on the chain: each launch at its
      // fuelling after the one before, or a little before or after that, or at a time drawn at random.
      let previous = 0;
      const free = [0, 0, 0];
      for (let i = 0; i < 1 + Math.floor(rand() * 7); i++) {
        const k = Math.floor(rand() * 3);
        const fuel = Math.round(rand() * 20 * M);
        const nights = sleepSeconds > 0 && rand() < 0.3 ? 1 : 0;
        const wakingSeconds = Math.round(rand() * 10 * H);
        const atStart = firstNight > 0 && rand() < 0.3 ? Math.round(rand() * 20 * H) : undefined;
        const pick = rand();
        const tight = Math.max(previous + fuel / RATE, free[k]);
        const launchAt =
          pick < 0.5 ? tight : pick < 0.6 ? tight - 1 : pick < 0.7 ? tight + 1 : Math.round(rand() * 2 * D);
        menu.push({
          id: `o${i}`,
          actualTime: wakingSeconds,
          nights,
          actualFuel: fuel,
          ...(atStart && { atStartSeconds: atStart }),
        });
        slots[k].push({ option: i, optionId: `o${i}`, launchAt });
        slots[k].sort((a, b) => a.launchAt - b.launchAt);
        previous = Math.max(previous, launchAt);
        free[k] = launchAt + (atStart ?? wakingSeconds + nights * sleepSeconds);
      }
      const sleep = {
        sleepSeconds,
        horizonSeconds: horizon,
        ...(wake > 0 && { wakeOffsetSeconds: wake }),
      };
      const pads = slots.map(slot =>
        slot.map(l => ({ launchAt: l.launchAt, padSeconds: menu[l.option].actualFuel / RATE }))
      );
      const chained = startChain(pads);
      const planner =
        padFault(pads) ??
        slots
          .map((slot, k) =>
            slotFault(
              slot.map((l, i) => ({
                launchAt: l.launchAt,
                wakingSeconds: menu[l.option].actualTime,
                nights: menu[l.option].nights,
                ...(menu[l.option].atStartSeconds !== undefined && { atStartSeconds: menu[l.option].atStartSeconds }),
                startChain: chained[k][i],
              })),
              sleep
            )
          )
          .find(f => f !== null) ??
        null;
      const arena = calendarFaults(
        slots,
        menu,
        menu.map(() => 1),
        {
          sleepSeconds,
          horizonSeconds: horizon,
          slots: 3,
          ...(wake > 0 && { wakeOffsetSeconds: wake }),
          fuelingRate: RATE,
        }
      );
      expect(planner === null, `${planner} / ${arena.join('; ')}`).toBe(arena.length === 0);
    }
  });
});

describe('the solver with the fueling pad', () => {
  // Ten-hour ships, each fuelled for ten minutes, the more the better.
  const tenHours = () => [makeOpt(600, 10 * H, [['B', 1]])];

  it('spaces launches that would go up together, and promises only what fits', async () => {
    const solve = await loadHighs();
    // Three slots of exactly three ten-hour launches: without the pad nine, with it the slot started last could not
    // even fit two after the stagger if they ran to the horizon, and none fits three.
    const problem = problemOf(tenHours(), 30 * H);
    const result = solveWith(problem, solve, undefined, { report: true });
    const order = padOrder(problem, result.calendar!);
    expect(order.length).toBe(6);
    expect(order[0].at).toBeGreaterThanOrEqual(600);
    for (let i = 1; i < order.length; i++) expect(order[i].at - order[i - 1].at).toBeGreaterThanOrEqual(600 - 1e-6);
    // The MILP knew: nothing was laid out only to be trimmed.
    expect(result.layoutStats!.launchesTrimmed).toBe(0);
    expect(arenaFaults(problem, result.calendar!, result.allocation)).toEqual([]);
  });

  it('keeps every doubled launch inside the window with the fuelling before it, and no more of them', async () => {
    const solve = await loadHighs();
    // A one-hour window, shorter than every ship: each slot's first launch is its overhang. Fuelled for 25 minutes
    // each, only two of the three fit before the window closes, and the plan doubles only those.
    const options = [...capacityVariants([makeOpt(1500, 10 * H, [['B', 1]])], H)];
    const problem = problemOf(options, 30 * H, { eventWindowSeconds: H });
    const result = solveWith(problem, solve, undefined, { report: true });
    const doubled = result.calendar!.flat().filter(l => l.doubled);
    expect(doubled.length).toBe(2);
    for (const l of doubled) expect(l.launchAt).toBeLessThanOrEqual(H);
    expect(arenaFaults(problem, result.calendar!, result.allocation)).toEqual([]);
    // With ten-minute fuellings all three fit.
    const quick = problemOf([...capacityVariants(tenHours(), H)], 30 * H, { eventWindowSeconds: H });
    const fast = solveWith(quick, solve, undefined, { report: true });
    expect(fast.calendar!.flat().filter(l => l.doubled && l.launchAt <= H).length).toBe(3);
    expect(arenaFaults(quick, fast.calendar!, fast.allocation)).toEqual([]);
  });

  it('chains the night start on the pad from T+0, and launches nothing else before the wake-up', async () => {
    const solve = await loadHighs();
    // Up 20 hours with 8 of sleep: four hours of night left.
    const wake = 20 * H;
    const problem = sleepProblem([makeOpt(600, 2 * H, [['B', 1]])], 2 * D, wake);
    const result = solveWith(problem, solve, undefined, { report: true });
    const order = padOrder(problem, result.calendar!);
    const firstWake = D - wake;
    const night = order.filter(l => l.at < firstWake);
    expect(night.length).toBe(3);
    // T+f1, T+f1+f2, T+f1+f2+f3: the chain, exactly.
    let chained = 0;
    for (const l of night) {
      chained += l.pad;
      expect(l.at).toBeCloseTo(chained, 6);
    }
    expect(arenaFaults(problem, result.calendar!, result.allocation)).toEqual([]);
  });

  it('fuels the first ship of a day overnight and spaces the rest from the wake-up', async () => {
    const solve = await loadHighs();
    const problem = sleepProblem([makeOpt(600, 4 * H, [['B', 1]])], 2 * D, 0);
    const result = solveWith(problem, solve, undefined, { report: true });
    const morning = padOrder(problem, result.calendar!).filter(l => l.at >= D && l.at < D + H);
    expect(morning.length).toBeGreaterThan(1);
    expect(morning[0].at).toBe(D);
    for (let i = 1; i < morning.length; i++)
      expect(morning[i].at - morning[i - 1].at).toBeGreaterThanOrEqual(600 - 1e-6);
    expect(arenaFaults(problem, result.calendar!, result.allocation)).toEqual([]);
  });

  it('lets the pad carry the start chain past bedtime, and holds every other launch awake', async () => {
    const solve = await loadHighs();
    const problem = sleepProblem([makeOpt(600, 4 * H, [['B', 1]])], 2 * D, W);
    const result = solveWith(problem, solve, undefined, { report: true });
    const first = padOrder(problem, result.calendar!).filter(l => l.at < S);
    expect(first.length).toBeGreaterThan(0);
    expect(first[0].at).toBeCloseTo(600, 6);
    expect(arenaFaults(problem, result.calendar!, result.allocation)).toEqual([]);
  });

  it('verifies every plan against the pad in every regime, as the arena does', async () => {
    const solve = await loadHighs();
    const options = [
      makeOpt(900, 10 * H, [['B', 1]]),
      makeOpt(120, 2 * H, [['B', 0.3]]),
      makeOpt(1800, 20 * H, [['B', 2]]),
    ];
    const problems = [
      problemOf(options, 3 * D),
      problemOf([...capacityVariants(options, 30 * H)], 3 * D, { eventWindowSeconds: 30 * H }),
      sleepProblem(options, 3 * D, 0),
      sleepProblem(options, 3 * D, 0, { eventWindowSeconds: 30 * H }),
      sleepProblem(options, 3 * D, 12 * H, { eventWindowSeconds: 30 * H }),
      sleepProblem(options, 3 * D, 20 * H, { eventWindowSeconds: 30 * H }),
    ];
    for (const problem of problems) {
      const result = solveWith(problem, solve, undefined, { report: true });
      expect(result.calendar!.flat().length).toBeGreaterThan(0);
      expect(arenaFaults(problem, result.calendar!, result.allocation)).toEqual([]);
    }
  });
});

describe('a problem without the fueling pad', () => {
  const options = [makeOpt(900, 10 * H, [['B', 1]]), makeOpt(120, 2 * H, [['B', 0.3]])];

  it('builds no pad row, level or column', () => {
    for (const problem of [
      problemOf(options, 3 * D, { fuelingRate: undefined }),
      sleepProblem(options, 3 * D, 0, { fuelingRate: undefined, eventWindowSeconds: 30 * H }),
    ]) {
      const model = buildModel(problem);
      expect(model.fuelingRate).toBe(0);
      expect(model.groups.every(g => g.padSeconds === 0)).toBe(true);
      const layout = layoutOf(model, 'oa');
      expect(layout.padLevels).toEqual([]);
      const milp = buildOaMilp(
        model,
        effectiveQs(model),
        model.sortedTargets.map(() => 1),
        [1, 0.1]
      );
      expect(milp.columnCount).toBe(layout.padBase);
      expect(milp.rowNames.some(name => name.startsWith('pad'))).toBe(false);
    }
  });

  it('is solved as it was: no layout statistics without sleep, and launches at T+0 together', async () => {
    const solve = await loadHighs();
    const result = solveWith(problemOf(options, 3 * D, { fuelingRate: undefined }), solve);
    expect(result.layoutStats).toBeUndefined();
    expect(result.calendar!.map(slot => slot[0]?.launchAt)).toEqual([0, 0, 0]);
  });

  it('reaches the solution only when the app passes one', async () => {
    const args = {
      options,
      recipeDag: craftDag(0.1),
      desiredArtifactNodeIds: ['A'],
      fuelCapacity: 1e9,
      timeCapacityPerSlot: 3 * D,
      ownedStock: new Map<string, number>(),
      maximumCost: undefined,
    };
    expect((await optimizeFull(args)).fuelingRate).toBeUndefined();
    const padded = await optimizeFull({ ...args, fuelingRate: 2 });
    expect(padded.fuelingRate).toBe(2);
    const first = padded.slots!.flatMap(slot => slot.launches.slice(0, 1).map(l => l.launchAt)).sort((a, b) => a - b);
    expect(first[0]).toBeGreaterThan(0);
  });
});
