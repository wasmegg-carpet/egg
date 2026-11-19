// The app's 2x capacity event (`lib/mission-optimizer/capacity.ts`) and what `optimizeFull` does with it. The
// solver's side is `event-window.spec.ts` and the arena's; what is tested here is the part the arena never sees,
// because the arena builds its own variants: the app's menu, and the plan it hands the card.

import { describe, expect, it } from 'vitest';
import { ei, newShipsConfig, shipMaxLevel, spaceshipList, type ShipsConfig } from 'lib';
import { buildRecipeDag } from '@/lib';
import { capacityVariants, eventWindowSecondsOf, MAX_DOUBLE_CAPACITY_SECONDS } from 'lib/mission-optimizer/capacity';
import { optimizeFull } from 'lib/mission-optimizer/optimizer-core';
import { enumerateLaunchOptions } from 'lib/mission-optimizer/problem-inputs';
import { sleepVariants } from 'lib/mission-optimizer/sleep';
import { loadHighs } from 'lib/mission-optimizer/solver/highs';
import { DEFAULT_TUNING, solveWith } from 'lib/mission-optimizer/solver/solve';
import type { PlanProblem } from 'lib/mission-optimizer/solver/types';
import type { LaunchOption } from 'lib/mission-optimizer/types';
import { craftDag, makeOpt } from './spec-helpers';
import { capacityVariants as arenaCapacityVariants } from '../arena/capacity';

const HOUR = 3600;
const TARGET = 'tachyon-deflector-4';

// Henerprise alone, with no FTL research: Short 24h, Standard 48h, Extended 96h. The Extended mission is longer
// than a whole 48h event, which is the case the overhang variant exists for.
function henerpriseOnly(): ShipsConfig {
  const config = newShipsConfig();
  config.epicResearchFTLLevel = 0;
  config.epicResearchZerogLevel = 0;
  config.showNodata = true;
  for (const ship of spaceshipList) config.shipVisibility[ship] = false;
  const hen = ei.MissionInfo.Spaceship.HENERPRISE;
  config.shipVisibility[hen] = true;
  config.shipLevels[hen] = shipMaxLevel(hen);
  return config;
}

const dagOf = () => buildRecipeDag([TARGET], 30, null, 0);

function problemOf(options: readonly LaunchOption[], eventWindowSeconds: number): PlanProblem {
  return {
    options,
    dag: dagOf(),
    targets: [TARGET],
    fuelCapacity: 1e18,
    timeCapacityPerSlot: 30 * 86400,
    slots: 3,
    ownedStock: new Map<string, number>(),
    eventWindowSeconds,
  };
}

describe('capacityVariants', () => {
  it('leaves the menu untouched without a window', () => {
    const menu = enumerateLaunchOptions(henerpriseOnly(), dagOf());
    for (const window of [0, -1, NaN]) expect(capacityVariants(menu, window)).toBe(menu);
  });

  it('emits normal and overhang for every launch, and event only for one that fits the window', () => {
    const menu = enumerateLaunchOptions(henerpriseOnly(), dagOf());
    const window = 48 * HOUR;
    const all = capacityVariants(menu, window);
    const byVariant = (v: string) => all.filter(o => o.variant === v);
    expect(byVariant('normal').map(o => o.id)).toEqual(menu.map(o => o.id));
    expect(byVariant('overhang')).toHaveLength(menu.length);
    expect(byVariant('event')).toHaveLength(menu.filter(o => o.actualTime <= window).length);
    expect(byVariant('event').length).toBeLessThan(menu.length);
  });

  it('a doubled option is the same launch with exactly twice the drops', () => {
    const menu = enumerateLaunchOptions(henerpriseOnly(), dagOf());
    const all = capacityVariants(menu, 48 * HOUR);
    const normal = all.find(o => o.variant === 'normal' && o.legendaryYieldVector.size > 0)!;
    const doubledOnes = all.filter(o => o.variant !== 'normal' && o.id.startsWith(`${normal.id}::`));
    expect(doubledOnes.map(o => o.variant).sort()).toEqual(
      normal.actualTime <= 48 * HOUR ? ['event', 'overhang'] : ['overhang']
    );
    for (const doubled of doubledOnes) {
      expect(doubled.actualFuel).toBe(normal.actualFuel);
      expect(doubled.fuelByEgg).toBe(normal.fuelByEgg);
      expect(doubled.actualTime).toBe(normal.actualTime);
      expect(doubled.rawTime).toBe(normal.rawTime);
      expect(doubled.cost).toBe(normal.cost);
      expect(doubled.ship).toBe(normal.ship);
      expect(doubled.targetAfxId).toBe(normal.targetAfxId);
      for (const [item, qty] of normal.yieldVector) expect(doubled.yieldVector.get(item)).toBe(qty * 2);
      for (const [item, qty] of normal.supplyVector) expect(doubled.supplyVector.get(item)).toBe(qty * 2);
      for (const [item, qty] of normal.legendaryYieldVector) {
        expect(doubled.legendaryYieldVector.get(item)).toBe(qty * 2);
      }
    }
  });

  it('composed over the sleep variants, keeps their nights and waking seconds', () => {
    const slept = sleepVariants([makeOpt(1, 30 * HOUR, [['B', 1]])], 8 * HOUR);
    const both = capacityVariants(slept, 48 * HOUR);
    expect(both.map(o => [o.id.replace(/^opt-\d+/, 'x'), o.actualTime, o.nights, o.variant])).toEqual(
      slept.flatMap(o => {
        const id = o.id.replace(/^opt-\d+/, 'x');
        return [
          [id, o.actualTime, o.nights, 'normal'],
          ...(o.actualTime <= 48 * HOUR ? [[`${id}::event`, o.actualTime, o.nights, 'event']] : []),
          [`${id}::overhang`, o.actualTime, o.nights, 'overhang'],
        ];
      })
    );
  });
});

describe('the app and the arena state the same rule', () => {
  it('give the same variants, entry for entry, at every window', () => {
    const menu = enumerateLaunchOptions(henerpriseOnly(), dagOf());
    const shape = (o: LaunchOption) => ({
      id: o.id,
      variant: o.variant,
      actualTime: o.actualTime,
      nights: o.nights,
      yieldVector: o.yieldVector,
      supplyVector: o.supplyVector,
      legendaryYieldVector: o.legendaryYieldVector,
    });
    for (const window of [0, HOUR, 24 * HOUR, 48 * HOUR, 96 * HOUR, 30 * 86400]) {
      expect(arenaCapacityVariants(menu, window).map(shape)).toEqual(capacityVariants(menu, window).map(shape));
    }
  });
});

describe('eventWindowSecondsOf', () => {
  it('reads anything unusable as no window and caps the rest at 48 hours', () => {
    expect(MAX_DOUBLE_CAPACITY_SECONDS).toBe(48 * HOUR);
    // Infinity included, as `sleepSecondsOf` reads it: no numeric value means "unlimited".
    for (const bad of [undefined, 0, -1, NaN, Infinity, -Infinity]) expect(eventWindowSecondsOf(bad)).toBe(0);
    expect(eventWindowSecondsOf(HOUR)).toBe(HOUR);
    expect(eventWindowSecondsOf(72 * HOUR)).toBe(48 * HOUR);
  });
});

describe('planning a real fleet through a 2x capacity window', () => {
  it('doubles exactly one launch per slot when the window is shorter than any mission', async () => {
    // 1h left against a fleet whose shortest mission is 24h: nothing fits the window row, so every doubled
    // launch has to come through the overhang column, and each slot takes one, at t = 0.
    const solve = await loadHighs();
    const options = capacityVariants(enumerateLaunchOptions(henerpriseOnly(), dagOf()), HOUR);
    expect(options.some(o => o.variant === 'event')).toBe(false);
    const result = solveWith(problemOf(options, HOUR), solve, DEFAULT_TUNING);
    for (const slot of result.calendar!) {
      const doubled = slot.filter(l => l.doubled);
      expect(doubled.map(l => [options[l.option].variant, l.launchAt])).toEqual([['overhang', 0]]);
    }
  });

  it('flies a mission longer than the whole window as an overhang, at 2x yield', async () => {
    const solve = await loadHighs();
    const window = 48 * HOUR;
    const extended = capacityVariants(enumerateLaunchOptions(henerpriseOnly(), dagOf()), window).filter(
      o => o.actualTime === 96 * HOUR
    );
    expect(extended.some(o => o.variant === 'event')).toBe(false);
    const result = solveWith(problemOf(extended, window), solve, DEFAULT_TUNING);
    const doubled = result.calendar!.flat().filter(l => l.doubled);
    expect(doubled.length).toBe(3);
    expect(doubled.every(l => extended[l.option].variant === 'overhang' && l.launchAt === 0)).toBe(true);
  });

  it('never launches a doubled mission past the window, and is never worse off for a longer one', async () => {
    const solve = await loadHighs();
    const menu = enumerateLaunchOptions(henerpriseOnly(), dagOf());
    let previous = -1;
    for (const window of [0, 24 * HOUR, 48 * HOUR, 30 * 86400]) {
      const options = capacityVariants(menu, window);
      const result = solveWith(problemOf(options, window), solve, DEFAULT_TUNING, { report: true });
      for (const slot of result.calendar!) {
        for (const l of slot) if (l.doubled) expect(l.launchAt).toBeLessThanOrEqual(window);
        expect(slot.filter(l => options[l.option].variant === 'overhang').length).toBeLessThanOrEqual(1);
      }
      const joint = result.reported!.jointProbability;
      expect(joint).toBeGreaterThanOrEqual(previous);
      previous = joint;
    }
  }, 60_000);
});

describe('optimizeFull with an event window', () => {
  const args = () => ({
    options: [makeOpt(1, 10, [['B', 1]]), makeOpt(1, 40, [['B', 5]])],
    recipeDag: craftDag(0.1),
    desiredArtifactNodeIds: ['A'],
    fuelCapacity: 1e6,
    timeCapacityPerSlot: 100,
    maximumCost: Infinity,
    ownedStock: new Map<string, number>(),
  });

  it('generates the variants itself, and says which launches are doubled', async () => {
    const sol = await optimizeFull({ ...args(), eventWindowSeconds: 20 });
    expect(sol.eventWindowSeconds).toBe(20);
    const variants = sol.choiceHistory.map(c => c.variant);
    expect(variants.every(v => v === 'normal' || v === 'event' || v === 'overhang')).toBe(true);
    // Free doubling: every slot fills its window, so there is a doubled launch per slot at least.
    const doubled = sol.choiceHistory.filter(c => c.variant !== 'normal').reduce((a, c) => a + c.numShipsLaunched, 0);
    expect(doubled).toBeGreaterThanOrEqual(3);
    expect(sol.slots?.every(s => s.loadSeconds <= 100)).toBe(true);
  });

  it('is today’s solution, field for field, with no window', async () => {
    const plain = await optimizeFull(args());
    const zero = await optimizeFull({ ...args(), eventWindowSeconds: 0 });
    expect('eventWindowSeconds' in plain).toBe(false);
    expect(plain.choiceHistory.every(c => !('variant' in c))).toBe(true);
    expect(zero).toEqual(plain);
  });

  it('caps the window at 48 hours', async () => {
    const sol = await optimizeFull({ ...args(), eventWindowSeconds: 100 * HOUR });
    expect(sol.eventWindowSeconds).toBe(48 * HOUR);
  });

  it('plans a window together with a sleep window, doubling only what launches inside it', async () => {
    // Two- and six-hour ships on a three-day horizon with eight hours of sleep and a three-hour window: the menu
    // is split by sleep, then by capacity. Three hours hold one two-hour `event` launch a slot and the overhang.
    const sol = await optimizeFull({
      ...args(),
      options: [makeOpt(1, 2 * HOUR, [['B', 1]]), makeOpt(1, 6 * HOUR, [['B', 4]])],
      fuelCapacity: 30,
      timeCapacityPerSlot: 3 * 86400,
      sleepSeconds: 8 * HOUR,
      eventWindowSeconds: 3 * HOUR,
    });
    expect(sol.sleepSeconds).toBe(8 * HOUR);
    expect(sol.eventWindowSeconds).toBe(3 * HOUR);
    const launched = (pick: (v: string | undefined) => boolean) =>
      sol.choiceHistory.filter(c => pick(c.variant)).reduce((a, c) => a + c.numShipsLaunched, 0);
    const events = launched(v => v === 'event');
    const overhangs = launched(v => v === 'overhang');
    expect(events + overhangs).toBeGreaterThan(0);
    expect(events).toBeLessThanOrEqual(3);
    expect(overhangs).toBeLessThanOrEqual(3);
    expect(launched(v => v === 'normal')).toBeGreaterThan(0);
    expect(sol.choiceHistory.every(c => c.actualTime <= 6 * HOUR)).toBe(true);
  }, 60_000);
});
