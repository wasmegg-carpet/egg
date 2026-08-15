// The alpha -> probability conversion, which is what the card prints: the closed-form step between the LP's
// answer and a number a player reads, which nothing else computes.

import { describe, it, expect } from 'vitest';
import { alphaToProb } from './value-function';
import { makeNode } from './spec-helpers';
import type { RecipeDAG, DAGNode } from './types';

const PREC = 9;

function dag(...nodes: DAGNode[]): RecipeDAG {
  return new Map(nodes.map(n => [n.id, n]));
}

describe('alphaToProb', () => {
  function makedag(pCraft: number) {
    return dag(makeNode('A', false, [], pCraft));
  }

  it('alpha=0 means no crafting regardless of pCraft', () => {
    const r = alphaToProb(0, new Map(), ['A'], makedag(0.5));
    expect(r.craftProbability).toBeCloseTo(0, PREC);
    expect(r.dropProbability).toBeCloseTo(0, PREC);
    expect(r.bestProbability).toBeCloseTo(0, PREC);
  });

  it('craft probability is 1 - (1-p)^alpha', () => {
    // p=0.5, alpha=4: 1 - 0.0625
    const r = alphaToProb(4, new Map(), ['A'], makedag(0.5));
    expect(r.craftProbability).toBeCloseTo(0.9375, PREC);
    expect(r.dropProbability).toBeCloseTo(0, PREC);
    expect(r.bestProbability).toBeCloseTo(0.9375, PREC);
  });

  it('craft probability with alpha=2', () => {
    const r = alphaToProb(2, new Map(), ['A'], makedag(0.5));
    expect(r.craftProbability).toBeCloseTo(0.75, PREC);
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
