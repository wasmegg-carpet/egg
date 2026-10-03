// Regression coverage for the quantity guard in `buildModel`: a non-finite inventory
// or yield must not reach the LP matrix. Asserted through a solve, not the matrix.

import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, envelopeErrorNats, logGrid, solveWith } from '@/lib/solver/solve';
import { loadHighs } from '@/lib/solver/highs';
import { makeNode, makeOpt } from './spec-helpers';
import type { RecipeDAG } from '@/lib/types';
import { maxLaunches } from '@/lib/solver/model';
import type { PlanProblem } from '@/lib/solver/types';

const dag: RecipeDAG = new Map([
  ['A1', makeNode('A1', false, [['B1', 1]], 0.5)],
  ['B1', makeNode('B1', true)],
]);

describe('buildModel rejects non-finite quantities the way it rejects non-finite costs', () => {
  it('a solve survives Infinity in yieldVector, legendaryYieldVector, and ownedStock together', async () => {
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
      ownedStock: new Map([['B1', NaN]]), // clamped to 0
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

describe('maxLaunches counts launches, not reciprocals', () => {
  it('fits 93 one-second missions into 93 seconds', () => {
    // `Math.floor(1 / (1 / 93))` is 93 only by luck of rounding; at 1/97 the same expression is 96.
    for (const seconds of [93, 97, 49, 3, 7]) {
      expect(maxLaunches(seconds, seconds / seconds)).toBe(seconds);
      expect(maxLaunches(1, 1 / seconds)).toBe(seconds);
    }
  });

  it('never returns a count the capacity cannot pay for', () => {
    for (const [capacity, unit] of [
      [1000, 3.3],
      [2.5, 1],
      [1e9, 7.7e-3],
      [0, 5],
    ] as [number, number][]) {
      const n = maxLaunches(capacity, unit);
      expect(n * unit).toBeLessThanOrEqual(capacity * (1 + 1e-12));
      expect((n + 1) * unit).toBeGreaterThan(capacity);
    }
  });
});

describe('the tangent grid rejects a tuning it cannot build', () => {
  it.each([1, 0, -3, 2.5, NaN])('refuses %p points', count => {
    expect(() => logGrid(1e-2, count)).toThrow(/at least 2 points/);
  });

  it.each([0, 1, 1.5, -1e-2, NaN])('refuses a floor of %p', floor => {
    expect(() => logGrid(floor, 50)).toThrow(/floor must lie in/);
  });
});

describe('a target asked for twice is one target', () => {
  it('does not square its own probability into the reported joint', async () => {
    const solve = await loadHighs();
    const problemOf = (targets: string[]): PlanProblem => ({
      options: [makeOpt(1, 1, [['B1', 4]])],
      dag,
      targets,
      fuelCapacity: 20,
      timeCapacityPerSlot: 1000,
      slots: 3,
      ownedStock: new Map(),
    });
    const once = solveWith(problemOf(['A1']), solve, DEFAULT_TUNING, { report: true });
    const twice = solveWith(problemOf(['A1', 'A1']), solve, DEFAULT_TUNING, { report: true });
    expect(once.reported!.jointProbability).toBeGreaterThan(0);
    expect(twice.reported!.jointProbability).toBe(once.reported!.jointProbability);
    expect(twice.allocation).toEqual(once.allocation);
  });
});
