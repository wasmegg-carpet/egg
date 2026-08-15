// The judge under a golden egg cap. The cap does not constrain an allocation — missions cost no golden eggs
// — so nothing would throw if the judge ignored it; each check below is the same allocation under a tighter purse.

import { describe, expect, it } from 'vitest';

import { makeNode, makeOpt } from '@/lib/spec-helpers';
import type { RecipeDAG } from '@/lib/types';
import { evaluateAllocation, evaluateAllocationFloat, evaluateAllocationJoint, type OracleInstance } from './evaluate';

// A1 = 2x B1, B1 = 2x C1, C1 drops. Two priced columns.
const singleDag: RecipeDAG = new Map([
  ['A1', makeNode('A1', false, [['B1', 2]], 0.5)],
  ['B1', makeNode('B1', false, [['C1', 2]])],
  ['C1', makeNode('C1', true)],
]);

// Two targets over a shared ingredient, so the cap has a split to change and
// not merely a total to shrink.
const jointDag: RecipeDAG = new Map([
  ['A1', makeNode('A1', false, [['C1', 2]], 0.5)],
  ['A2', makeNode('A2', false, [['C1', 2]], 0.5)],
  ['C1', makeNode('C1', true)],
]);

function instance(dag: RecipeDAG, targets: string[], owned: number, budget?: OracleInstance['craftBudget']) {
  return {
    label: 'budget-spec',
    seed: 0,
    options: [makeOpt(1, 1, [['C1', 0]])],
    dag,
    targets,
    fuelCapacity: 1e9,
    timeCapacityPerSlot: 1e9,
    // Inventory supplied as base yield, so the allocation is irrelevant and
    // every difference below is the budget's doing.
    baseYield: new Map([['C1', owned]]),
    craftBudget: budget,
  } satisfies OracleInstance;
}

const alloc = [0];
const prices = (a: number, b: number): ReadonlyMap<string, number> =>
  new Map([
    ['A1', a],
    ['B1', b],
  ]);

describe('the judge under a craft budget', () => {
  it('scores an uncapped instance exactly as before the cap existed', () => {
    // 40 C1 -> 20 B1 -> 10 A1.
    const uncapped = evaluateAllocation(instance(singleDag, ['A1'], 40), alloc);
    expect(uncapped.expectedCrafts).toBeCloseTo(10, 9);
    const slack = evaluateAllocation(
      instance(singleDag, ['A1'], 40, { capacity: 1e9, unitPrices: prices(100, 25) }),
      alloc
    );
    expect(slack.expectedCrafts).toBeCloseTo(10, 9);
    expect(slack.score).toBeCloseTo(uncapped.score, 12);
  });

  it('buys fewer crafts under a tighter purse, on the exact path', () => {
    // The full 10 A1 bill 10*100 + 20*25 = 1500.
    const inst = instance(singleDag, ['A1'], 40, { capacity: 300, unitPrices: prices(100, 25) });
    const capped = evaluateAllocation(inst, alloc);
    expect(capped.expectedCrafts!).toBeLessThan(10);
    expect(capped.expectedCrafts!).toBeGreaterThan(0);
    // Whatever split it picks has to be one the purse covers: crafting a's
    // ingredients is 2 B1 per A1, so the bill is 100a + 25*2a = 150a.
    expect(150 * capped.expectedCrafts!).toBeLessThanOrEqual(300 + 1e-6);
  });

  it('is monotone in the capacity', () => {
    let previous = -1;
    for (const capacity of [150, 300, 600, 1200, 1500, 3000]) {
      const score = evaluateAllocation(
        instance(singleDag, ['A1'], 40, { capacity, unitPrices: prices(100, 25) }),
        alloc
      ).score;
      expect(score).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = score;
    }
  });

  it('applies the cap on the float ranking path too', () => {
    const loose = evaluateAllocationFloat(
      instance(singleDag, ['A1'], 40, { capacity: 1500, unitPrices: prices(100, 25) }),
      alloc
    );
    const tight = evaluateAllocationFloat(
      instance(singleDag, ['A1'], 40, { capacity: 300, unitPrices: prices(100, 25) }),
      alloc
    );
    expect(tight).toBeLessThan(loose);
  });

  it('applies the cap on the joint Frank-Wolfe path', () => {
    const jointPrices: ReadonlyMap<string, number> = new Map([
      ['A1', 100],
      ['A2', 100],
    ]);
    const uncapped = evaluateAllocationJoint(instance(jointDag, ['A1', 'A2'], 40), alloc);
    const capped = evaluateAllocationJoint(
      instance(jointDag, ['A1', 'A2'], 40, { capacity: 400, unitPrices: jointPrices }),
      alloc
    );
    expect(capped.jointProbability).toBeLessThan(uncapped.jointProbability);
    const bill = capped.perTarget.reduce((sum, t) => sum + 100 * t.expectedCrafts, 0);
    expect(bill).toBeLessThanOrEqual(400 + 1e-6);
  });

  it('treats a zero capacity as a real cap when the columns are priced', () => {
    // Zero means "craft nothing", not "no budget": an implementation that skipped a zero-capacity row
    // entirely would pass the test below and fail this one.
    const scored = evaluateAllocation(
      instance(singleDag, ['A1'], 40, { capacity: 0, unitPrices: prices(100, 25) }),
      alloc
    );
    expect(scored.expectedCrafts).toBe(0);
  });

  it('rejects a capacity that could never bind, rather than scoring around it', () => {
    for (const capacity of [-1, NaN, Infinity]) {
      expect(() =>
        evaluateAllocation(instance(singleDag, ['A1'], 40, { capacity, unitPrices: prices(100, 25) }), alloc)
      ).toThrow(/finite and non-negative/);
    }
  });

  it('ignores a budget that prices nothing, rather than pinning every craft to zero', () => {
    // A capacity with no priced column is not a cap of zero: nothing in the
    // instance is known to cost anything, so nothing can consume the purse.
    const scored = evaluateAllocation(instance(singleDag, ['A1'], 40, { capacity: 0, unitPrices: new Map() }), alloc);
    expect(scored.expectedCrafts).toBeCloseTo(10, 9);
  });
});
