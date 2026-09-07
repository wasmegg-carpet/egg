// Regression coverage for the quantity guard in `buildModel`: a non-finite inventory
// or yield must not reach the LP matrix. Asserted through a solve, not the matrix.

import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, envelopeErrorNats, solveWith } from '@/lib/solver/oa';
import { loadHighs } from '@/lib/solver/highs';
import { makeNode, makeOpt } from './spec-helpers';
import type { RecipeDAG } from '@/lib/types';
import type { PlanProblem } from '@/lib/solver/types';

const dag: RecipeDAG = new Map([
  ['A1', makeNode('A1', false, [['B1', 1]], 0.5)],
  ['B1', makeNode('B1', true)],
]);

describe('buildModel rejects non-finite quantities the way it rejects non-finite costs', () => {
  it('a solve survives Infinity in yieldVector, legendaryYieldVector, and baseYield together', async () => {
    const solve = await loadHighs();
    const problem: PlanProblem = {
      options: [
        makeOpt(1, 1, [['B1', Infinity]]), // dropped: non-finite yield
        makeOpt(1, 1, [], [['A1', Infinity]]), // dropped: non-finite legendary yield
        makeOpt(1, 1, [['B1', 1]]), // the only usable option
      ],
      dag,
      targets: ['A1'],
      fuelCapacity: 60,
      timeCapacityPerSlot: 1000,
      slots: 3,
      baseYield: new Map([['B1', NaN]]), // clamped to 0
    };
    const result = solveWith(problem, solve);
    expect(result.allocation).toHaveLength(problem.options.length);
    expect(result.allocation.every(n => Number.isFinite(n) && n >= 0)).toBe(true);
    expect(result.allocation[2]).toBeGreaterThan(0);
    expect(result.allocation[0]).toBe(0);
    expect(result.allocation[1]).toBe(0);
  });
});

describe('the default tangent grid stays inside its stated envelope error', () => {
  it('starts at 1, stays in (0, 1], and errs by under 2e-3 nats', () => {
    const sigmaGrid = DEFAULT_TUNING.sigmaGrid;
    expect(sigmaGrid[0]).toBeCloseTo(1, 12);
    const floor = sigmaGrid[sigmaGrid.length - 1];
    expect(floor).toBeGreaterThan(0);
    expect(floor).toBeLessThan(1);
    expect(envelopeErrorNats(floor, sigmaGrid.length)).toBeLessThan(2e-3);
  });
});
