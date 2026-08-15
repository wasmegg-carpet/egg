import { describe, expect, it } from 'vitest';
import { ei, getArtifactTierPropsFromId, Inventory, multiCraftCost, singleCraftCost } from 'lib';

import {
  computePlanCraftingCost,
  craftCostOf,
  craftingPriceParamsOf,
  fractionalCraftCost,
  previousCraftsOf,
  sumCraftChainCost,
} from './optimizer-cost';
import { computeCraftChainTree } from './optimizer-tree';
import { lt1, lt2, lt3, lt4, makeNode, makeSolution, totemDag } from './spec-helpers';
import type { RecipeDAG } from './types';

const Name = ei.ArtifactSpec.Name;
const Level = ei.ArtifactSpec.Level;

function paramsOf(nodeId: string) {
  return getArtifactTierPropsFromId(nodeId).recipe!.crafting_price;
}

// artifactStatus.count is what Inventory reads as `crafted`.
function inventoryWithCrafts(crafts: [ei.ArtifactSpec.Level, number][]): Inventory {
  return new Inventory({
    artifactStatus: crafts.map(([level, count]) => ({
      spec: { name: Name.LUNAR_TOTEM, level },
      count,
      discovered: true,
      recipeDiscovered: true,
    })),
  });
}

describe('craftingPriceParamsOf', () => {
  it('returns the tier’s crafting price params', () => {
    expect(craftingPriceParamsOf(lt4)).toBe(paramsOf(lt4));
  });
});

describe('previousCraftsOf', () => {
  it('is 0 without an inventory', () => {
    expect(previousCraftsOf(null, lt3)).toBe(0);
  });

  it('reads the per-item crafted count from the save', () => {
    const inventory = inventoryWithCrafts([
      [Level.LESSER, 7],
      [Level.NORMAL, 3],
    ]);
    expect(previousCraftsOf(inventory, lt2)).toBe(7);
    expect(previousCraftsOf(inventory, lt3)).toBe(3);
    expect(previousCraftsOf(inventory, lt4)).toBe(0);
  });
});

describe('fractionalCraftCost', () => {
  const params = paramsOf(lt3);

  it('charges every craft at the player’s next craft price', () => {
    for (const n of [1, 2, 5, 20]) {
      expect(fractionalCraftCost(params, 0, n)).toBe(n * singleCraftCost(params, 0));
    }
  });

  it('over-states multiCraftCost past the first craft, never under-states it', () => {
    expect(fractionalCraftCost(params, 0, 1)).toBe(multiCraftCost(params, 0, 1));
    for (const n of [2, 5, 20]) {
      expect(fractionalCraftCost(params, 0, n)).toBeGreaterThan(multiCraftCost(params, 0, n));
    }
  });

  it('honours the starting craft index, so a veteran pays less', () => {
    expect(fractionalCraftCost(params, 30, 4)).toBe(4 * singleCraftCost(params, 30));
    expect(fractionalCraftCost(params, 30, 4)).toBeLessThan(fractionalCraftCost(params, 0, 4));
  });

  it('is proportional in crafts, so a fraction costs a fraction', () => {
    expect(fractionalCraftCost(params, 0, 3.4)).toBeCloseTo(3.4 * singleCraftCost(params, 0), 9);
    // additive, hence no whole-craft boundary to price around
    expect(fractionalCraftCost(params, 0, 1.4) + fractionalCraftCost(params, 0, 2)).toBeCloseTo(
      fractionalCraftCost(params, 0, 3.4),
      9
    );
  });

  it('is monotone, with no jump at a whole craft count', () => {
    const justBelow = fractionalCraftCost(params, 0, 2.999);
    const at = fractionalCraftCost(params, 0, 3);
    const justAbove = fractionalCraftCost(params, 0, 3.001);
    expect(justBelow).toBeLessThanOrEqual(at);
    expect(at).toBeLessThanOrEqual(justAbove);
    expect(justAbove - justBelow).toBeLessThan(singleCraftCost(params, 3));
  });

  it('is 0 for non-positive or non-finite counts', () => {
    expect(fractionalCraftCost(params, 0, 0)).toBe(0);
    expect(fractionalCraftCost(params, 0, -2)).toBe(0);
    expect(fractionalCraftCost(params, 0, NaN)).toBe(0);
    expect(fractionalCraftCost(params, 0, Infinity)).toBe(0);
  });
});

describe('craftCostOf', () => {
  it('prices crafts of a tier seeded with the player’s own craft count', () => {
    const inventory = inventoryWithCrafts([[Level.NORMAL, 12]]);
    expect(craftCostOf(lt3, 5, inventory)).toBe(5 * singleCraftCost(paramsOf(lt3), 12));
  });

  it('is 0 for an item with no recipe', () => {
    // T1 totems drop; they are never crafted.
    expect(craftingPriceParamsOf(lt1)).toBeNull();
    expect(craftCostOf(lt1, 10, null)).toBe(0);
  });
});

describe('computePlanCraftingCost', () => {
  it('prices a multi-tier craft chain against lib’s own cost functions', () => {
    const inventory = inventoryWithCrafts([
      [Level.LESSER, 4], // lt2: 4 previous crafts
      [Level.NORMAL, 9], // lt3: 9 previous crafts
    ]);
    const solution = makeSolution({
      recipeDag: totemDag(),
      craftPrimal: new Map([
        [lt4, 2],
        [lt3, 6],
        [lt2, 3],
        [lt1, 0], // leaf, never crafted
      ]),
    });

    const { total, byNode } = computePlanCraftingCost(solution, inventory);

    // each node's own previous-craft count seeds its own unit price
    const expected = {
      [lt4]: 2 * singleCraftCost(paramsOf(lt4), 0),
      [lt3]: 6 * singleCraftCost(paramsOf(lt3), 9),
      [lt2]: 3 * singleCraftCost(paramsOf(lt2), 4),
    };
    // the leaf is left out entirely, not billed at 0
    expect(Object.fromEntries(byNode)).toEqual(expected);
    expect(total).toBe(expected[lt4] + expected[lt3] + expected[lt2]);
  });

  it('prices fractional LP craft counts proportionally, not by rounding', () => {
    const solution = makeSolution({
      recipeDag: totemDag(),
      craftPrimal: new Map([[lt3, 2.5]]),
    });
    const { total } = computePlanCraftingCost(solution, null);
    expect(total).toBeCloseTo(2.5 * singleCraftCost(paramsOf(lt3), 0), 9);
    // neither floored nor ceiled to a whole craft
    expect(total).toBeGreaterThan(2 * singleCraftCost(paramsOf(lt3), 0));
    expect(total).toBeLessThan(3 * singleCraftCost(paramsOf(lt3), 0));
  });

  it('charges nothing for a plan that crafts nothing', () => {
    expect(computePlanCraftingCost(makeSolution({ recipeDag: totemDag() }), null)).toEqual({
      total: 0,
      byNode: new Map(),
    });
  });
});

describe('sumCraftChainCost', () => {
  it('is 0 for a missing tree', () => {
    expect(sumCraftChainCost(null)).toBe(0);
  });

  it('counts a node shared by two branches once', () => {
    // lt2 and lt3 both consume lt1; the duplicate occurrence carries the same
    // metrics and must not be billed twice.
    const solution = makeSolution({
      recipeDag: totemDag(),
      craftPrimal: new Map([
        [lt4, 1],
        [lt3, 2],
        [lt2, 1],
      ]),
      perTarget: [{ nodeId: lt4, expectedCrafts: 1, bestProbability: 0, craftProbability: 0, dropProbability: 0 }],
    });
    const tree = computeCraftChainTree(solution, lt4, null)!;

    expect(sumCraftChainCost(tree)).toBeCloseTo(
      singleCraftCost(paramsOf(lt4), 0) + 2 * singleCraftCost(paramsOf(lt3), 0) + singleCraftCost(paramsOf(lt2), 0),
      9
    );
  });

  it('splits a shared craft pool so the target shares sum to the plan bill', () => {
    const dag: RecipeDAG = new Map([
      [lt3, makeNode(lt3, false, [[lt2, 2]])],
      [lt4, makeNode(lt4, false, [[lt2, 2]])],
      [lt2, makeNode(lt2, false, [[lt1, 2]])],
      [lt1, makeNode(lt1, true)],
    ]);
    const prob = { bestProbability: 0, craftProbability: 0, dropProbability: 0 };
    const solution = makeSolution({
      recipeDag: dag,
      craftPrimal: new Map([
        [lt3, 1],
        [lt4, 1],
        [lt2, 4],
      ]),
      perTarget: [
        { nodeId: lt3, expectedCrafts: 1, ...prob },
        { nodeId: lt4, expectedCrafts: 1, ...prob },
      ],
    });

    const lt3Cost = sumCraftChainCost(computeCraftChainTree(solution, lt3, null));
    const lt4Cost = sumCraftChainCost(computeCraftChainTree(solution, lt4, null));
    expect(lt3Cost).toBeCloseTo(craftCostOf(lt3, 1, null) + craftCostOf(lt2, 4, null) / 2, 9);
    expect(lt4Cost).toBeCloseTo(craftCostOf(lt4, 1, null) + craftCostOf(lt2, 4, null) / 2, 9);

    const { total } = computePlanCraftingCost(solution, null);
    expect(total).toBe(craftCostOf(lt3, 1, null) + craftCostOf(lt4, 1, null) + craftCostOf(lt2, 4, null));
    expect(lt3Cost + lt4Cost).toBeCloseTo(total, 9);

    expect(craftCostOf(lt2, 2, null) * 2).toBeCloseTo(craftCostOf(lt2, 4, null), 9);
  });
});
