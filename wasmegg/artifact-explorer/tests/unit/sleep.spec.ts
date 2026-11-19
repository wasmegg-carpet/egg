// The app's sleep model (`lib/mission-optimizer/sleep.ts`) and what `optimizeFull` does with it. The solver's side of a
// sleep-aware problem is the arena's subject; what is tested here is the part the arena never sees, because
// the arena builds its own variants: that the app's menu is the same rule, and that the plan it hands the
// card is the one the solver laid out.

import { describe, it, expect } from 'vitest';

import { ei, MissionType } from 'lib';
import { optimizeFull } from 'lib/mission-optimizer/optimizer-core';
import { computeMissionLegendaryRows } from 'lib/mission-optimizer/optimizer-views';
import {
  MAX_SLEEP_SECONDS,
  sleepCapacity,
  sleepSecondsOf,
  sleepVariants,
  startVariants,
  wakeOffsetSecondsOf,
} from 'lib/mission-optimizer/sleep';
import { MAX_SLEEP_HOURS } from 'lib/mission-optimizer/schedule-settings';
import { isMissionFilters, newMissionFilters, type MissionFilters } from '@/store/schema';
import {
  sleepCapacity as arenaSleepCapacity,
  sleepVariants as arenaSleepVariants,
  startVariants as arenaStartVariants,
  wakeOffsetOf as arenaWakeOffsetOf,
} from '../arena/sleep';
import { craftDag, makeOpt, makeSolution } from './spec-helpers';

const HOUR = 3600;
const DAY = 24 * HOUR;
const EIGHT_HOURS = 8 * HOUR;

const variantsOf = (hours: number, sleep = EIGHT_HOURS) => {
  const option: { id: string; actualTime: number; nights?: number } = { id: 'x', actualTime: hours * HOUR };
  return sleepVariants([option], sleep).map(v => [v.id, v.actualTime / HOUR, v.nights]);
};

describe('sleepVariants', () => {
  // The worked examples of a 16-hour waking window and an 8-hour night.
  it('gives a short ship a daytime variant and a zero-second launch at bedtime', () => {
    expect(variantsOf(1 / 3)).toEqual([
      ['x', 1 / 3, 0],
      ['x~night1', 0, 1],
    ]);
  });

  it('charges an overnight launch only the waking hours it takes', () => {
    const [day, night] = variantsOf(9.6);
    expect(day).toEqual(['x', 9.6, 0]);
    expect(night[0]).toBe('x~night1');
    expect(night[1]).toBeCloseTo(1.6, 9);
    expect(night[2]).toBe(1);
  });

  it('has no daytime variant for a ship longer than the waking window', () => {
    const variants = variantsOf(19.2);
    expect(variants).toHaveLength(1);
    expect(variants[0][1]).toBeCloseTo(11.2, 9);
    expect(variants[0][2]).toBe(1);
  });

  it('offers every number of nights a long ship can span', () => {
    const [one, two] = variantsOf(28.8);
    expect(one[1]).toBeCloseTo(20.8, 9);
    expect(one[2]).toBe(1);
    // Two nights enclose one whole waking window, which is the least it can then cost.
    expect(two).toEqual(['x~night2', 16, 2]);

    const extended = variantsOf(38.4);
    expect(extended.map(v => v[2])).toEqual([1, 2]);
    expect(extended[0][1]).toBeCloseTo(30.4, 9);
    expect(extended[1][1]).toBeCloseTo(22.4, 9);
  });

  it('splits the floored charge, so the effort floor reaches overnight launches too', () => {
    // A 20-minute ship at Low effort is charged a day. Launched once a day it spans one night or two, and
    // either way costs a whole waking window: sleep must not make Low cheaper than it is without.
    expect(variantsOf(24)).toEqual([
      ['x~night1', 16, 1],
      ['x~night2', 16, 2],
    ]);
  });

  it('carries the rest of the option through untouched', () => {
    const option = { id: 'a', actualTime: HOUR, rawTime: 600, cost: 7 };
    for (const variant of sleepVariants([option], EIGHT_HOURS)) {
      expect(variant.rawTime).toBe(600);
      expect(variant.cost).toBe(7);
    }
    expect(option).toEqual({ id: 'a', actualTime: HOUR, rawTime: 600, cost: 7 });
  });

  it('returns the menu itself, untouched, with no sleep', () => {
    // Regression: a zero-length night used to give every option a `~night<m>` twin charging its whole duration
    // and a night it does not spend, where the arena's copy (and `capacityVariants` for a zero window) returns
    // the menu as given.
    const menu = [
      { id: 'a', actualTime: HOUR },
      { id: 'b', actualTime: 2 * DAY },
    ];
    expect(sleepVariants(menu, 0)).toBe(menu);
    expect(sleepVariants(menu, -1)).toBe(menu);
    expect(sleepVariants(menu, NaN)).toBe(menu);
    expect(menu).toEqual([
      { id: 'a', actualTime: HOUR },
      { id: 'b', actualTime: 2 * DAY },
    ]);
  });

  // The arena judges plans against its own copy of this rule. The two are separate on purpose, and this is
  // what keeps them the same rule.
  it('agrees with the arena on every duration and sleep window', () => {
    const options = [];
    for (let seconds = 0; seconds <= 4 * DAY; seconds += 1234) options.push({ id: `d${seconds}`, actualTime: seconds });
    options.push({ id: 'w', actualTime: 16 * HOUR }, { id: 'day', actualTime: DAY });
    for (const hours of [0, 0.5, 4, 6, 8, 10, 12, MAX_SLEEP_HOURS]) {
      expect(sleepVariants(options, hours * HOUR)).toEqual(arenaSleepVariants(options, hours * HOUR));
    }
  });
});

describe('startVariants', () => {
  // Twenty hours awake with an 8-hour night: four hours of it left, the first wake-up four hours in.
  const at = (hours: number, horizon = 3 * DAY) =>
    startVariants([{ id: 'x', actualTime: hours * HOUR }], EIGHT_HOURS, 20 * HOUR, horizon).map(v => [
      v.id,
      v.actualTime / HOUR,
      v.nights,
      v.atStartSeconds! / HOUR,
    ]);

  it('takes nothing from a ship back before the first wake-up, and holds the slot to its landing', () => {
    expect(at(1)).toEqual([['x~start', 0, 0, 1]]);
    expect(at(4)).toEqual([['x~start', 0, 0, 4]]);
  });

  it('takes the waking hours after the wake-up a ship is still out for', () => {
    expect(at(10)).toEqual([['x~start', 6, 0, 10]]);
    // Landing at bedtime, the whole first day.
    expect(at(20)).toEqual([['x~start', 16, 0, 20]]);
  });

  it('takes the night a ship lands in, and the day before it, but no night the horizon cuts', () => {
    expect(at(24)).toEqual([['x~start', 16, 1, 24]]);
    expect(at(30)).toEqual([['x~start', 18, 1, 30]]);
    // With the horizon a day, the night it lands in is no part of the budget.
    expect(at(24, DAY)).toEqual([['x~start', 16, 0, 24]]);
    expect(at(25, DAY)).toEqual([]);
  });

  it('is nothing unless the plan starts in the night', () => {
    for (const wake of [0, 4 * HOUR, 16 * HOUR]) {
      expect(startVariants([{ id: 'x', actualTime: HOUR }], EIGHT_HOURS, wake, DAY)).toEqual([]);
    }
    expect(startVariants([{ id: 'x', actualTime: HOUR }], 0, 20 * HOUR, DAY)).toEqual([]);
  });

  it('agrees with the arena on every charge, offset, horizon and sleep window', () => {
    const options = [];
    for (let seconds = 0; seconds <= 4 * DAY; seconds += 1234) options.push({ id: `d${seconds}`, actualTime: seconds });
    options.push({ id: 'w', actualTime: 16 * HOUR }, { id: 'day', actualTime: DAY });
    for (const sleep of [4 * HOUR, EIGHT_HOURS, 12 * HOUR, MAX_SLEEP_HOURS * HOUR]) {
      for (const hours of [0, 12, 16, 17, 20, 23, 23.9]) {
        for (const horizon of [HOUR, 5 * HOUR, DAY, 2.5 * DAY, 4 * DAY]) {
          expect(startVariants(options, sleep, hours * HOUR, horizon)).toEqual(
            arenaStartVariants(options, sleep, hours * HOUR, horizon)
          );
        }
      }
    }
  });
});

describe('sleepCapacity', () => {
  it('counts whole days as a waking window and a night each', () => {
    expect(sleepCapacity(3 * DAY, EIGHT_HOURS)).toEqual({ wakingSecondsPerSlot: 48 * HOUR, nightsPerSlot: 3 });
  });

  it('gives a trailing partial day its waking hours and no night', () => {
    expect(sleepCapacity(2.5 * DAY, EIGHT_HOURS)).toEqual({ wakingSecondsPerSlot: 44 * HOUR, nightsPerSlot: 2 });
    // Past bedtime on the last day there is nothing more to launch into.
    expect(sleepCapacity(2 * DAY + 20 * HOUR, EIGHT_HOURS)).toEqual({
      wakingSecondsPerSlot: 48 * HOUR,
      nightsPerSlot: 2,
    });
  });

  it('agrees with the arena on every horizon', () => {
    for (const horizon of [0, 1, HOUR, 15 * HOUR, DAY, DAY + 1, 2.5 * DAY, 30 * DAY, NaN, -5, Infinity]) {
      for (const hours of [4, 8, 12, MAX_SLEEP_HOURS]) {
        expect(sleepCapacity(horizon, hours * HOUR)).toEqual(arenaSleepCapacity(horizon, hours * HOUR));
      }
    }
  });

  it('agrees with the arena on every horizon, wake offset and sleep window', () => {
    for (const horizon of [0, 1, HOUR, 15 * HOUR, DAY, DAY + 1, 2.5 * DAY, 30 * DAY, NaN, -5]) {
      for (const sleep of [4 * HOUR, EIGHT_HOURS, 12 * HOUR, 16 * HOUR]) {
        for (const hours of [0, 0.5, 4, 8, 12, 16, 17, 20, 23, 23.9]) {
          const wake = wakeOffsetSecondsOf(hours * HOUR, sleep);
          expect(sleepCapacity(horizon, sleep, wake)).toEqual(arenaSleepCapacity(horizon, sleep, wake));
        }
      }
    }
  });
});

describe('the sleep setting', () => {
  it('is read as 0 by the app without sleep or past a day, and like the arena otherwise', () => {
    for (const value of [undefined, 0, -1, NaN, Infinity, DAY, 30 * HOUR]) {
      expect(wakeOffsetSecondsOf(value, EIGHT_HOURS)).toBe(0);
    }
    expect(wakeOffsetSecondsOf(5 * HOUR, 0)).toBe(0);
    for (const sleep of [4 * HOUR, EIGHT_HOURS, 12 * HOUR]) {
      for (const hours of [0, 1, 5.5, 12, 16, 19, 23]) {
        expect(wakeOffsetSecondsOf(hours * HOUR, sleep)).toBe(arenaWakeOffsetOf(hours * HOUR, sleep));
      }
    }
  });

  it('reads anything that is not a usable window as none', () => {
    for (const value of [undefined, 0, -1, NaN, Infinity]) expect(sleepSecondsOf(value)).toBe(0);
    expect(sleepSecondsOf(EIGHT_HOURS)).toBe(EIGHT_HOURS);
    expect(sleepSecondsOf(23 * HOUR)).toBe(MAX_SLEEP_SECONDS);
  });

  it('defaults to planning around the clock', () => {
    expect(newMissionFilters().sleepHours).toBe(0);
  });

  it('accepts filters saved before the setting existed', () => {
    const older: Partial<MissionFilters> = newMissionFilters();
    delete older.sleepHours;
    expect(isMissionFilters(older)).toBe(true);
    expect(isMissionFilters({ ...older, sleepHours: 8 })).toBe(true);
    expect(isMissionFilters({ ...older, sleepHours: '8' })).toBe(false);
  });

  it('accepts filters saved before sleep could be switched off, and reads them as on exactly when hours were set', () => {
    const older: Partial<MissionFilters> = newMissionFilters();
    delete older.sleepEnabled;
    expect(isMissionFilters({ ...older, sleepHours: 8 })).toBe(true);
    expect(isMissionFilters({ ...older, sleepEnabled: 'on' })).toBe(false);
    expect(newMissionFilters().sleepEnabled).toBe(false);
  });

  it('accepts filters saved before the time since waking existed, and rejects a mistyped one', () => {
    const older: Partial<MissionFilters> = newMissionFilters();
    delete older.hoursSinceWake;
    expect(isMissionFilters(older)).toBe(true);
    expect(isMissionFilters({ ...older, hoursSinceWake: 3.5 })).toBe(true);
    expect(isMissionFilters({ ...older, hoursSinceWake: '3.5' })).toBe(false);
    expect(newMissionFilters().hoursSinceWake).toBe(0);
  });
});

describe('optimizeFull with a sleep window', () => {
  // One-hour launches of a leaf the target is crafted from, and nothing else limiting the plan: the more
  // launches, the better, so the plan is as many as the days hold.
  const args = (horizon: number) => ({
    options: [makeOpt(1, HOUR, [['B', 1]])],
    recipeDag: craftDag(0.1),
    desiredArtifactNodeIds: ['A'],
    fuelCapacity: 1e9,
    timeCapacityPerSlot: horizon,
    ownedStock: new Map<string, number>(),
    maximumCost: undefined,
  });
  const launched = (choices: { nights?: number; numShipsLaunched: number }[], overnight: boolean) =>
    choices.filter(c => (c.nights ?? 0) > 0 === overnight).reduce((n, c) => n + c.numShipsLaunched, 0);

  it('is the plan it always was when the window is absent or zero', async () => {
    const around = await optimizeFull(args(3 * DAY));
    expect(around.sleepSeconds).toBeUndefined();
    expect(around.choiceHistory.every(c => !('nights' in c))).toBe(true);
    expect(launched(around.choiceHistory, false)).toBe(3 * 72);
    expect(await optimizeFull({ ...args(3 * DAY), sleepSeconds: 0 })).toEqual(around);
  });

  it('fills each waking window and flies one ship through each night', async () => {
    const around = await optimizeFull(args(3 * DAY));
    const plan = await optimizeFull({ ...args(3 * DAY), sleepSeconds: EIGHT_HOURS });

    expect(plan.sleepSeconds).toBe(EIGHT_HOURS);
    // Sixteen one-hour launches fit a 16-hour day exactly, in each of three slots on each of three days.
    expect(launched(plan.choiceHistory, false)).toBe(3 * 3 * 16);
    // The bedtime launch takes no waking time at all, and is still a launch: one per slot per night.
    expect(launched(plan.choiceHistory, true)).toBe(3 * 3);
    const bedtime = plan.choiceHistory.find(c => (c.nights ?? 0) > 0)!;
    expect(bedtime.nights).toBe(1);
    expect(bedtime.actualTime).toBe(0);

    // Each slot's calendar ends when the player wakes on the last morning, which is the horizon.
    expect(plan.slots).toHaveLength(3);
    for (const slot of plan.slots!) {
      expect(slot.launches).toHaveLength(3 * 17);
      expect(slot.loadSeconds).toBe(3 * DAY);
      expect(slot.rawLoadSeconds).toBe(3 * 17 * HOUR);
    }
    expect(plan.timeUnitsUsed).toBe(3 * DAY);
    expect(plan.runningTimeSeconds).toBe(3 * 17 * HOUR);

    // Sleeping costs launches, so it cannot be worth more than not sleeping.
    expect(plan.bestProbability).toBeGreaterThan(0);
    expect(plan.bestProbability).toBeLessThan(around.bestProbability);
  });

  it('plans a trailing partial day without a night after it', async () => {
    const plan = await optimizeFull({ ...args(2.5 * DAY), sleepSeconds: EIGHT_HOURS });
    // Two whole days and twelve waking hours of a third: 44 daytime launches and two nights per slot.
    expect(launched(plan.choiceHistory, false)).toBe(3 * 44);
    expect(launched(plan.choiceHistory, true)).toBe(3 * 2);
    expect(plan.timeUnitsUsed).toBe(2.5 * DAY);
  });

  it('returns no plan, rather than an unlaunchable one, when the horizon holds no launch', async () => {
    const plan = await optimizeFull({ ...args(0.5 * HOUR), sleepSeconds: EIGHT_HOURS });
    expect(plan.choiceHistory).toHaveLength(0);
    expect(plan.timeUnitsUsed).toBe(0);
    expect(plan.slots).toBeUndefined();
  });
});

describe('legendary sources of a sleep-aware plan', () => {
  it('lists a mission flown by day and overnight as one source', () => {
    const ship = new MissionType(ei.MissionInfo.Spaceship.HENERPRISE, ei.MissionInfo.DurationType.SHORT);
    const choice = (numShipsLaunched: number, nights: number) => ({
      ship,
      actualFuel: 0,
      actualFuelByEgg: new Map<ei.Egg, number>(),
      actualTime: 0,
      nights,
      target: '',
      targetAfxId: ei.ArtifactSpec.Name.UNKNOWN,
      numShipsLaunched,
      supplyVector: new Map<string, number>(),
      legendarySupplyVector: new Map([['A', 0.01]]),
    });
    const rows = computeMissionLegendaryRows(makeSolution({ choiceHistory: [choice(30, 0), choice(10, 1)] }), 'A');
    expect(rows).toHaveLength(1);
    expect(rows[0].numShipsLaunched).toBe(40);
    expect(rows[0].legendaryDrops).toBeCloseTo(0.4, 12);
  });
});
