// The per-egg fuel budget: budgeting against what is stocked in the tank right now,
// egg by egg, instead of against what the tank could hold.

import { describe, it, expect } from 'vitest';
import { ei, perfectShipsConfig } from 'lib';
import { buildRecipeDag } from '@/lib';
import { buildModel } from '@/lib/solver/model';
import { enumerateLaunchOptions } from '@/lib/phases';
import { optimize } from './spec-helpers';

const TARGET = 'puzzle-cube-4';
const HUGE = 1e18;

function problemOf(fuelAxes?: { egg: ei.Egg | null; capacity: number }[]) {
  const dag = buildRecipeDag([TARGET], 30);
  return {
    options: enumerateLaunchOptions(perfectShipsConfig, dag),
    dag,
    targets: [TARGET],
    fuelCapacity: 500e12,
    fuelAxes,
    timeCapacityPerSlot: 30 * 86400,
    slots: 3,
    baseYield: new Map<string, number>(),
  };
}

describe('fuel axes', () => {
  it('defaults to the single aggregate tank budget', () => {
    const model = buildModel(problemOf());
    expect(model.fuelAxes).toEqual([{ egg: null, capacity: 500e12 }]);
    // One entry per axis, and it is the same normalization as before the vectorization.
    for (const group of model.groups) {
      expect(group.fuelFractions).toHaveLength(1);
      expect(group.fuelFractions[0]).toBeGreaterThanOrEqual(0);
    }
  });

  it('separates options that cost the same in total but draw on different eggs', () => {
    const perEgg = buildModel(
      problemOf([
        { egg: ei.Egg.CURIOSITY, capacity: HUGE },
        { egg: ei.Egg.INTEGRITY, capacity: HUGE },
        { egg: ei.Egg.RESILIENCE, capacity: HUGE },
        { egg: ei.Egg.KINDNESS, capacity: HUGE },
      ])
    );
    for (const group of perEgg.groups) {
      expect(group.fuelFractions).toHaveLength(4);
    }
    // Non-binding budgets keep every option the aggregate model had, but the finer key
    // can only split groups, never merge them.
    const aggregate = buildModel(problemOf());
    expect(perEgg.groups.length).toBeGreaterThanOrEqual(aggregate.groups.length);
  });

  it('drops options needing more of one egg than the player has', () => {
    const generous = buildModel(
      problemOf([
        { egg: ei.Egg.CURIOSITY, capacity: HUGE },
        { egg: ei.Egg.INTEGRITY, capacity: HUGE },
      ])
    );
    const starved = buildModel(
      problemOf([
        { egg: ei.Egg.CURIOSITY, capacity: HUGE },
        { egg: ei.Egg.INTEGRITY, capacity: 1 },
      ])
    );
    expect(starved.groups.length).toBeLessThan(generous.groups.length);
    // Nothing surviving charges more than the one unit of integrity available.
    for (const group of starved.groups) {
      expect(group.fuelFractions[1]).toBeLessThanOrEqual(1);
    }
  });
});

describe('optimizeFull with a per-egg budget', () => {
  const config = {
    desiredArtifactNodeIds: [TARGET],
    fuelTankCapacity: 500e12,
    timeBudgetSeconds: 30 * 86400,
    includeNotEnoughData: false,
  };

  // Humility is free everywhere in this tool (`phases.ts` strips it), so an empty tank
  // does not ground the player: it leaves exactly the ships that burn humility alone —
  // Chicken One, Nine and Heavy. Anything needing a budgeted egg is gone.
  it('an empty tank leaves only the missions that burn nothing budgeted', async () => {
    const dag = buildRecipeDag([TARGET], 30);
    const empty = new Map<ei.Egg, number>([
      [ei.Egg.CURIOSITY, 0],
      [ei.Egg.INTEGRITY, 0],
      [ei.Egg.RESILIENCE, 0],
      [ei.Egg.KINDNESS, 0],
    ]);
    const solution = await optimize(config, perfectShipsConfig, dag, new Map(), 0, undefined, undefined, 0, empty);
    expect(solution.fuelUsed).toBe(0);
    expect(solution.fuelByEgg.size).toBe(0);
    for (const slot of solution.slots) {
      for (const run of slot.runs) {
        expect(run.actualFuelByEgg.size).toBe(0);
      }
    }
  });

  it('a stocked tank binds each egg it reports burning', async () => {
    const dag = buildRecipeDag([TARGET], 30);
    const stock = new Map<ei.Egg, number>([
      [ei.Egg.CURIOSITY, 20e12],
      [ei.Egg.INTEGRITY, 20e12],
      [ei.Egg.RESILIENCE, 20e12],
      [ei.Egg.KINDNESS, 20e12],
    ]);
    const solution = await optimize(config, perfectShipsConfig, dag, new Map(), 0, undefined, undefined, 0, stock);
    expect(solution.slots.some(s => s.runs.length > 0)).toBe(true);
    for (const [egg, used] of solution.fuelByEgg) {
      expect(used).toBeLessThanOrEqual(stock.get(egg)! * (1 + 1e-9));
    }
  });

  it('a tank stocked past every mission cost matches the uncapped plan', async () => {
    const dag = buildRecipeDag([TARGET], 30);
    const lavish = new Map<ei.Egg, number>([
      [ei.Egg.CURIOSITY, HUGE],
      [ei.Egg.INTEGRITY, HUGE],
      [ei.Egg.RESILIENCE, HUGE],
      [ei.Egg.KINDNESS, HUGE],
    ]);
    const capped = await optimize(config, perfectShipsConfig, dag, new Map());
    const perEgg = await optimize(
      { ...config, fuelTankCapacity: HUGE },
      perfectShipsConfig,
      dag,
      new Map(),
      0,
      undefined,
      undefined,
      0,
      lavish
    );
    // Strictly looser budget, so it can never do worse than the 500T tank.
    expect(perEgg.bestProbability).toBeGreaterThanOrEqual(capped.bestProbability - 1e-9);
  });
});
