// The 2x mission capacity window: enumeration, the two per-slot rows that hold it, and the schedule the
// solver states its answer in.

import { describe, expect, it } from 'vitest';
import { ei, MissionType, newShipsConfig, shipMaxLevel, spaceshipList, type ShipsConfig } from 'lib';
import { buildRecipeDag } from '@/lib';
import { enumerateLaunchOptions } from '@/lib/phases';
import { buildModel } from '@/lib/solver/model';
import { loadHighs } from '@/lib/solver/highs';
import { solveWith } from '@/lib/solver/oa';
import type { PlanProblem, PlanResult } from '@/lib/solver/types';
import type { LaunchOption } from '@/lib/types';
import { allocationOf, craftDag, makeOpt } from './spec-helpers';

const HOUR = 3600;
const TARGET = 'tachyon-deflector-4';

// Henerprise alone, with no FTL research: Short 24h, Standard 48h, Extended 96h. The Extended mission is
// longer than a whole 48h event, which is the case the overhang column exists for.
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

function problemOf(options: LaunchOption[], eventWindowSeconds: number, timeCapacityPerSlot = 30 * 86400) {
  return {
    options,
    dag: dagOf(),
    targets: [TARGET],
    fuelCapacity: 1e18,
    timeCapacityPerSlot,
    slots: 3,
    baseYield: new Map<string, number>(),
    eventWindowSeconds,
  } satisfies PlanProblem;
}

// Every launch in the plan, in the order its slot flies it, with the offset it starts at.
function launches(problem: PlanProblem, result: PlanResult) {
  return result.schedule.map(runs => {
    let offset = 0;
    const out: { option: LaunchOption; count: number; firstStart: number; lastStart: number }[] = [];
    for (const run of runs) {
      const option = problem.options[run.option];
      out.push({
        option,
        count: run.count,
        firstStart: offset,
        lastStart: offset + (run.count - 1) * option.actualTime,
      });
      offset += run.count * option.actualTime;
    }
    return out;
  });
}

describe('enumeration under a 2x capacity window', () => {
  it('emits one variant with no event and three with one', () => {
    const config = henerpriseOnly();
    const dag = dagOf();

    const none = enumerateLaunchOptions(config, dag, 0, 0);
    expect(none.length).toBeGreaterThan(0);
    expect(none.every(o => o.variant === 'normal')).toBe(true);

    const window = 48 * HOUR;
    const evented = enumerateLaunchOptions(config, dag, 0, window);
    const byVariant = (v: string) => evented.filter(o => o.variant === v);

    // One `normal` and one `overhang` per launch, unconditionally; `event` only where the mission is
    // short enough to finish launching inside the window.
    expect(byVariant('normal')).toHaveLength(none.length);
    expect(byVariant('overhang')).toHaveLength(none.length);
    expect(byVariant('event')).toHaveLength(none.filter(o => o.actualTime <= window).length);
    expect(byVariant('event').every(o => o.actualTime <= window)).toBe(true);
    expect(byVariant('event').length).toBeLessThan(none.length);
  });

  it('a doubled option is the same launch with exactly twice the drops', () => {
    const config = henerpriseOnly();
    const dag = dagOf();
    const evented = enumerateLaunchOptions(config, dag, 0, 48 * HOUR);

    const normal = evented.find(o => o.variant === 'normal' && o.legendaryYieldVector.size > 0)!;
    const doubledOnes = evented.filter(o => o.variant !== 'normal' && o.id.startsWith(`${normal.id}::`));
    expect(doubledOnes.length).toBeGreaterThan(0);

    for (const doubled of doubledOnes) {
      expect(doubled.actualFuel).toBe(normal.actualFuel);
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

  it('leaves the no-event menu untouched at exactly zero', () => {
    const config = henerpriseOnly();
    const dag = dagOf();
    const zero = enumerateLaunchOptions(config, dag, 0, 0);
    const negative = enumerateLaunchOptions(config, dag, 0, -1);
    const nan = enumerateLaunchOptions(config, dag, 0, NaN);
    expect(negative.map(o => o.id)).toEqual(zero.map(o => o.id));
    expect(nan.map(o => o.id)).toEqual(zero.map(o => o.id));
  });
});

describe('the model separates what a schedule entry has to name', () => {
  it('keeps options apart when they differ only in ship or target', () => {
    // Identical in every number the group key looks at besides ship and target.
    const shared: [string, number][] = [['B', 1]];
    const a = makeOpt(1, 10, shared, [], ei.ArtifactSpec.Name.LUNAR_TOTEM);
    const sameShipOtherTarget = makeOpt(1, 10, shared, [], ei.ArtifactSpec.Name.TUNGSTEN_ANKH);
    const otherShip: LaunchOption = {
      ...makeOpt(1, 10, shared, [], ei.ArtifactSpec.Name.LUNAR_TOTEM),
      ship: new MissionType(ei.MissionInfo.Spaceship.HENERPRISE, ei.MissionInfo.DurationType.EPIC),
    };

    const model = buildModel({
      options: [a, sameShipOtherTarget, otherShip],
      dag: craftDag(0.1),
      targets: ['A'],
      fuelCapacity: 100,
      timeCapacityPerSlot: 100,
      slots: 3,
      baseYield: new Map(),
    });

    // Three distinct launches, so three groups, so a schedule entry naming `members[0]` names exactly one
    // of them.
    expect(model.groups).toHaveLength(3);
    expect(model.groups.every(g => g.members.length === 1)).toBe(true);
    expect(model.groups.flatMap(g => g.members).sort()).toEqual([0, 1, 2]);
  });

  it('never merges an event column into the overhang one', () => {
    // The two are identical in fuel, duration and every yield; merging them would drop one of the two
    // rows that hold the window.
    const evented = enumerateLaunchOptions(henerpriseOnly(), dagOf(), 0, 48 * HOUR);
    const model = buildModel(problemOf(evented, 48 * HOUR));
    const counts = { normal: 0, event: 0, overhang: 0 };
    for (const g of model.groups) counts[g.variant]++;
    expect(counts.event).toBeGreaterThan(0);
    expect(counts.overhang).toBeGreaterThan(0);
    expect(model.groups.every(g => g.members.length === 1)).toBe(true);
  });

  it('drops a doubled option handed in with no window rather than flying it unconstrained', () => {
    // With no window there is no row to hold the option inside one, so it must disappear rather than fly
    // at 2x unconstrained.
    const evented = enumerateLaunchOptions(henerpriseOnly(), dagOf(), 0, 48 * HOUR);
    const model = buildModel(problemOf(evented, 0));
    expect(model.groups.length).toBeGreaterThan(0);
    expect(model.groups.every(g => g.variant === 'normal')).toBe(true);
  });
});

describe('planning through a 2x capacity window', () => {
  it('treats a zero window and an absent one as the same problem', async () => {
    const solve = await loadHighs();
    const options = [makeOpt(1, 10, [['B', 2]]), makeOpt(2, 20, [['B', 5]])];
    const base = {
      options,
      dag: craftDag(0.1),
      targets: ['A'],
      fuelCapacity: 50,
      timeCapacityPerSlot: 100,
      slots: 3,
      baseYield: new Map<string, number>(),
    };
    const absent = solveWith(base, solve);
    const zero = solveWith({ ...base, eventWindowSeconds: 0 }, solve);
    expect(zero.schedule).toEqual(absent.schedule);
  });

  it('doubles exactly one launch per slot when the window is shorter than any mission', async () => {
    // 1h left against a menu whose shortest mission is 24h: nothing fits the window row, so `event` is
    // empty and every doubled launch has to come through the overhang column.
    const solve = await loadHighs();
    const options = enumerateLaunchOptions(henerpriseOnly(), dagOf(), 0, HOUR);
    expect(options.some(o => o.variant === 'event')).toBe(false);

    const problem = problemOf(options, HOUR);
    const result = solveWith(problem, solve);
    const alloc = allocationOf(result, options.length);
    expect(alloc.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);

    let doubled = 0;
    for (const slot of launches(problem, result)) {
      const boosted = slot.filter(l => l.option.variant !== 'normal');
      expect(boosted.every(l => l.option.variant === 'overhang')).toBe(true);
      const inSlot = boosted.reduce((a, l) => a + l.count, 0);
      expect(inSlot).toBeLessThanOrEqual(1);
      // The doubled launch is free, so every slot the plan uses takes it.
      if (slot.length > 0) expect(inSlot).toBe(1);
      doubled += inSlot;
    }
    expect(doubled).toBe(3);
  });

  it('flies a mission longer than the whole window as an overhang, at 2x yield', async () => {
    // Henerprise Extended is 96h against a 48h event, so it can never be an `event` column, but it is
    // still doubled if it launches now.
    const solve = await loadHighs();
    const window = 48 * HOUR;
    const all = enumerateLaunchOptions(henerpriseOnly(), dagOf(), 0, window);
    const extended = all.filter(o => o.actualTime === 96 * HOUR);
    expect(extended.some(o => o.variant === 'event')).toBe(false);

    const problem = problemOf(extended, window);
    const result = solveWith(problem, solve);

    const flown = launches(problem, result).flat();
    const boosted = flown.filter(l => l.option.variant !== 'normal');
    expect(boosted.length).toBeGreaterThan(0);
    expect(boosted.every(l => l.option.variant === 'overhang')).toBe(true);
    expect(boosted.every(l => l.count === 1 && l.firstStart === 0)).toBe(true);

    for (const l of boosted) {
      const plain = all.find(o => o.variant === 'normal' && `${o.id}::overhang` === l.option.id)!;
      for (const [item, qty] of plain.legendaryYieldVector) {
        expect(l.option.legendaryYieldVector.get(item)).toBe(qty * 2);
      }
    }
  });

  it('never launches a doubled mission past the window', async () => {
    const solve = await loadHighs();
    const window = 48 * HOUR;
    const options = enumerateLaunchOptions(henerpriseOnly(), dagOf(), 0, window);
    const problem = problemOf(options, window);
    const result = solveWith(problem, solve);

    for (const slot of launches(problem, result)) {
      let overhangs = 0;
      for (const l of slot) {
        if (l.option.variant === 'normal') continue;
        if (l.option.variant === 'overhang') overhangs += l.count;
        expect(l.lastStart).toBeLessThanOrEqual(window);
      }
      expect(overhangs).toBeLessThanOrEqual(1);
      // Doubled launches come first, so the window boundary is one cut in the list rather than a filter
      // over it.
      const variants = slot.map(l => (l.option.variant === 'normal' ? 1 : 0));
      expect(variants).toEqual([...variants].sort((a, b) => a - b));
    }
  });

  it('is never worse off for a longer window', async () => {
    const solve = await loadHighs();
    const config = henerpriseOnly();
    const dag = dagOf();
    let previous = -1;
    for (const window of [0, 24 * HOUR, 48 * HOUR, 30 * 86400]) {
      const options = enumerateLaunchOptions(config, dag, 0, window);
      const result = solveWith(problemOf(options, window), solve, undefined, { report: true });
      const joint = result.reported!.jointProbability;
      expect(joint).toBeGreaterThanOrEqual(previous);
      previous = joint;
    }
  }, 60_000);
});
