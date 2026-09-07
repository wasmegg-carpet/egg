// The golden egg cap, from the outside: stated the way the UI states it — a capacity handed to `optimize`
// — and checked on the plan that comes back, rather than on which model carries the row.

import { describe, expect, it } from 'vitest';
import { ei, getArtifactTierPropsFromId, Inventory, multiCraftCost, perfectShipsConfig, singleCraftCost } from 'lib';

import { buildRecipeDag, computeBaseYield, computePlanCraftingCost, computeCraftUnitPrices } from '@/lib';
import { loadHighs } from '@/lib/solver/highs';
import { DEFAULT_TUNING, solveWith } from '@/lib/solver/oa';
import type { PlanProblem } from '@/lib/solver/types';
import type { RecipeDAG } from '@/lib/types';
import { makeNode, makeOpt, optimize } from './spec-helpers';

const Name = ei.ArtifactSpec.Name;
const Level = ei.ArtifactSpec.Level;

describe('computeCraftUnitPrices', () => {
  const cubes = buildRecipeDag(['puzzle-cube-4'], 30);

  it('prices every craftable at the player next craft and skips the leaves', () => {
    const prices = computeCraftUnitPrices(cubes, null);
    for (const [nodeId, node] of cubes) {
      const params = getArtifactTierPropsFromId(nodeId).recipe?.crafting_price;
      if (node.isLeaf || !params) {
        expect(prices.has(nodeId)).toBe(false);
      } else {
        expect(prices.get(nodeId)).toBe(singleCraftCost(params, 0));
      }
    }
  });

  it('reads the crafted count out of the inventory, so a veteran is priced lower', () => {
    // artifactStatus.count is what Inventory reads as `crafted`; puzzle-cube-2
    // is the LESSER tier of the family.
    const inventory = new Inventory({
      artifactStatus: [
        {
          spec: { name: Name.PUZZLE_CUBE, level: Level.LESSER },
          count: 40,
          discovered: true,
          recipeDiscovered: true,
        },
      ],
    });
    const params = getArtifactTierPropsFromId('puzzle-cube-2').recipe!.crafting_price;
    const veteran = computeCraftUnitPrices(cubes, inventory);
    expect(veteran.get('puzzle-cube-2')).toBe(singleCraftCost(params, 40));
    expect(veteran.get('puzzle-cube-2')!).toBeLessThan(computeCraftUnitPrices(cubes, null).get('puzzle-cube-2')!);
  });

  it('never under-states the bill: the linear price dominates the real curve', () => {
    const unit = computeCraftUnitPrices(cubes, null);
    const params = getArtifactTierPropsFromId('puzzle-cube-3').recipe!.crafting_price;
    for (const crafts of [1, 2, 5, 20, 100]) {
      expect(unit.get('puzzle-cube-3')! * crafts).toBeGreaterThanOrEqual(multiCraftCost(params, 0, crafts));
    }
  });
});

describe('optimize', () => {
  const config = {
    desiredArtifactNodeIds: ['puzzle-cube-4'],
    includeNotEnoughData: false,
    fuelTankCapacity: 2_000_000_000,
    timeBudgetSeconds: 3 * 24 * 3600,
  };
  const cubes = buildRecipeDag(config.desiredArtifactNodeIds, 30);
  const baseYield = computeBaseYield(null, config.desiredArtifactNodeIds, cubes);
  const unitPrices = computeCraftUnitPrices(cubes, null);

  it('brings the priced plan under a cap that the uncapped plan blows', async () => {
    const uncapped = await optimize(config, perfectShipsConfig, cubes, baseYield);
    const uncappedCost = computePlanCraftingCost(uncapped, null).total;
    expect(uncappedCost).toBeGreaterThan(0);

    const capacity = uncappedCost / 4;
    const capped = await optimize(config, perfectShipsConfig, cubes, baseYield, 0, undefined, {
      capacity,
      unitPrices,
    });

    // The bill can land *on* the cap rather than under it, and the two sides reach the same number by
    // different summations through HiGHS, so the comparison carries a relative epsilon.
    expect(computePlanCraftingCost(capped, null).total).toBeLessThanOrEqual(capacity * (1 + 1e-9));
    expect(capped.bestProbability).toBeLessThanOrEqual(uncapped.bestProbability + 1e-9);
  }, 60_000);
});

// `model.ts` and `value-function.ts` both drop a budget they cannot turn into a row, so an invalid
// capacity would otherwise read as *no* cap. The store's own schema guard rejects these before they
// reach the app path; this covers every other caller of `optimizeFull`.
describe('optimizeFull rejects a craft budget it could not enforce', () => {
  const cubes2 = buildRecipeDag(['puzzle-cube-4'], 30);
  const baseYield2 = computeBaseYield(null, ['puzzle-cube-4'], cubes2);
  const prices2 = computeCraftUnitPrices(cubes2, null);
  const config2 = {
    desiredArtifactNodeIds: ['puzzle-cube-4'],
    includeNotEnoughData: false,
    fuelTankCapacity: 2_000_000_000,
    timeBudgetSeconds: 3 * 86400,
  };

  it.each([-1, NaN, Infinity, -Infinity])('throws on capacity %p', async capacity => {
    await expect(
      optimize(config2, perfectShipsConfig, cubes2, baseYield2, 0, undefined, { capacity, unitPrices: prices2 })
    ).rejects.toThrow(/finite and non-negative/);
  });

  it('accepts a capacity of zero, which is a cap and not an absent one', async () => {
    const plan = await optimize(config2, perfectShipsConfig, cubes2, baseYield2, 0, undefined, {
      capacity: 0,
      unitPrices: prices2,
    });
    expect(computePlanCraftingCost(plan, null).total).toBe(0);
  }, 60_000);
});

// The judge re-derives the objective the MILP steered towards, so it has to score over the same
// polytope. Left off the judge's LP, the budget row would let `reported` claim a craft split the
// plan cannot afford — which is exactly the arena's C2-honesty failure mode.
describe('the judge scores against the craft budget', () => {
  const dag: RecipeDAG = new Map([
    ['A1', makeNode('A1', false, [['B1', 1]], 0.5)],
    ['B1', makeNode('B1', true)],
  ]);

  function problemOf(craftBudget?: PlanProblem['craftBudget']): PlanProblem {
    return {
      options: [makeOpt(1, 1, [['B1', 10]])],
      dag,
      targets: ['A1'],
      fuelCapacity: 60,
      timeCapacityPerSlot: 1000,
      slots: 3,
      baseYield: new Map(),
      craftBudget,
    };
  }

  it('reports a strictly lower joint probability under a cap that binds', async () => {
    const solve = await loadHighs();
    const uncapped = solveWith(problemOf(), solve, DEFAULT_TUNING, { report: true });
    expect(uncapped.reported!.jointProbability).toBeGreaterThan(0);

    // One golden egg per A1 craft, one egg in the purse: at most one craft is affordable, so the
    // judge must not price the plan on the crafts the ingredients alone would allow.
    const capped = solveWith(problemOf({ capacity: 1, unitPrices: new Map([['A1', 1]]) }), solve, DEFAULT_TUNING, {
      report: true,
    });
    expect(capped.reported!.jointProbability).toBeLessThan(uncapped.reported!.jointProbability);
    expect(capped.reported!.jointProbability).toBeCloseTo(1 - Math.exp(-(-Math.log(1 - 0.5))), 9);
  }, 60_000);
});
