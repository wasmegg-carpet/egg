// The alpha -> probability conversion, which is what the card prints: the closed-form step between the LP's
// answer and a number a player reads, which nothing else computes.

import { describe, it, expect } from 'vitest';
import { alphaToProb } from '@/lib/value-function';
import { makeNode } from './spec-helpers';
import type { RecipeDAG, DAGNode } from '@/lib/types';

const PREC = 9;

function dag(...nodes: DAGNode[]): RecipeDAG {
  return new Map(nodes.map(n => [n.id, n]));
}

describe('alphaToProb', () => {
  function makedag(pCraft: number) {
    return dag(makeNode('A', false, [], pCraft));
  }

  it('alpha=0 means no crafting regardless of pCraft', () => {
    // pCraft=1 is the only value that makes this title testable: at every other pCraft the closed form
    // returns 0 at alpha=0 on its own, so a guard that stopped excluding alpha=0 would go unseen.
    for (const pCraft of [0, 0.5, 1]) {
      const r = alphaToProb(0, new Map(), ['A'], makedag(pCraft));
      expect(r.craftProbability).toBeCloseTo(0, PREC);
      expect(r.dropProbability).toBeCloseTo(0, PREC);
      expect(r.bestProbability).toBeCloseTo(0, PREC);
    }
  });

  it('craft probability is 1 - (1-p)^alpha', () => {
    // p=0.5, so 1 - 2^-alpha. One `it` over several alphas rather than one per alpha: they run the same
    // branch and differ only in the arithmetic, which is what the table is for.
    for (const [alpha, expected] of [
      [1, 0.5],
      [2, 0.75],
      [4, 0.9375],
    ] as const) {
      const r = alphaToProb(alpha, new Map(), ['A'], makedag(0.5));
      expect(r.craftProbability).toBeCloseTo(expected, PREC);
      expect(r.dropProbability).toBeCloseTo(0, PREC);
      expect(r.bestProbability).toBeCloseTo(expected, PREC);
    }
  });

  it('treats a target the dag does not describe as uncraftable', () => {
    // The `?? 0` behind pCraft decides what the card prints for a node nothing is known about. The other
    // default reachable by a one-character change is 1, which prints a guaranteed legendary.
    const r = alphaToProb(4, new Map(), ['ghost'], makedag(0.5));
    expect(r.craftProbability).toBe(0);
    expect(r.bestProbability).toBe(0);
  });

  it('drop-only path when pCraft is 0', () => {
    const r = alphaToProb(1, new Map([['A', 1]]), ['A'], makedag(0));
    expect(r.craftProbability).toBeCloseTo(0, PREC);
    expect(r.dropProbability).toBeCloseTo(1 - Math.exp(-1), PREC);
    expect(r.bestProbability).toBeCloseTo(1 - Math.exp(-1), PREC);
  });

  it('pCraft=1 is a guaranteed craft', () => {
    const r = alphaToProb(2, new Map(), ['A'], makedag(1.0));
    expect(r.craftProbability).toBeCloseTo(1, PREC);
    expect(r.bestProbability).toBeCloseTo(1, PREC);
  });

  it('drop probability follows the Poisson rate', () => {
    const r = alphaToProb(0, new Map([['A', 2]]), ['A'], makedag(0));
    expect(r.craftProbability).toBeCloseTo(0, PREC);
    expect(r.dropProbability).toBeCloseTo(1 - Math.exp(-2), PREC);
  });

  it('combines craft and drop by inclusion-exclusion', () => {
    const craft = 0.9375; // p=0.5, alpha=4
    const drop = 1 - Math.exp(-1);
    const expectedBest = 1 - (1 - craft) * (1 - drop);
    const r = alphaToProb(4, new Map([['A', 1]]), ['A'], makedag(0.5));
    expect(r.craftProbability).toBeCloseTo(craft, PREC);
    expect(r.dropProbability).toBeCloseTo(drop, PREC);
    expect(r.bestProbability).toBeCloseTo(expectedBest, PREC);
  });

  it('empty desired list gives all zeros', () => {
    const r = alphaToProb(10, new Map([['A', 5]]), [], makedag(0.9));
    expect(r.craftProbability).toBe(0);
    expect(r.dropProbability).toBe(0);
    expect(r.bestProbability).toBe(0);
  });
});
