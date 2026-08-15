// The pipeline must not depend on the order targets were selected in: each target's legendary craft
// probability comes from its own crafted count, not from whichever target happened to be first.

import { describe, it, expect } from 'vitest';
import { ei, Inventory } from 'lib';
import { buildRecipeDag } from '@/lib';
import { loadHighs } from '@/lib/solver/highs';
import { DEFAULT_TUNING, solveWith } from '@/lib/solver/oa';
import type { PlanProblem } from '@/lib/solver/types';
import { makeNode, makeOpt } from './spec-helpers';
import type { RecipeDAG } from '@/lib/types';

const Name = ei.ArtifactSpec.Name;
const Level = ei.ArtifactSpec.Level;

const FEATHER = 'phoenix-feather-4';
const CHALICE = 'the-chalice-4';

// A save with very different craft histories for the two targets.
function savedInventory(): Inventory {
  return new Inventory({
    artifactStatus: [
      { spec: { name: Name.PHOENIX_FEATHER, level: Level.GREATER }, count: 20 },
      { spec: { name: Name.THE_CHALICE, level: Level.GREATER }, count: 0 },
    ],
  });
}

function craftProbabilities(ids: string[], previousCraftsOverride?: number): Map<string, number> {
  const dag = buildRecipeDag(ids, 30, savedInventory(), previousCraftsOverride);
  return new Map(ids.map(id => [id, dag.get(id)!.legendaryCraftProbability]));
}

describe('buildRecipeDag with a save loaded', () => {
  it('gives each target its own crafted count', () => {
    const p = craftProbabilities([FEATHER, CHALICE]);
    expect(p.get(FEATHER)!).toBeGreaterThan(p.get(CHALICE)!);
  });

  it('is unaffected by the order the targets were selected in', () => {
    const forward = craftProbabilities([FEATHER, CHALICE]);
    const reversed = craftProbabilities([CHALICE, FEATHER]);
    expect(reversed.get(FEATHER)).toBe(forward.get(FEATHER));
    expect(reversed.get(CHALICE)).toBe(forward.get(CHALICE));
  });

  it('applies a manual override to every target', () => {
    const p = craftProbabilities([FEATHER, CHALICE], 20);
    expect(p.get(CHALICE)).toBe(p.get(FEATHER));
    expect(p.get(FEATHER)).toBe(craftProbabilities([FEATHER, CHALICE]).get(FEATHER));
  });
});

// `perTarget` is parallel to the caller's target list, so the seam has to map back out of the sorted order
// the model works in. Getting that wrong mislabels which artifact each probability belongs to.

// Two targets over one shared ingredient, with different craft probabilities so
// their per-target factors are distinguishable.
const jointDag: RecipeDAG = new Map([
  ['A1', makeNode('A1', false, [['C1', 2]], 0.5)],
  ['A2', makeNode('A2', false, [['C1', 2]], 0.8)],
  ['C1', makeNode('C1', true)],
]);

function problemOf(targets: string[]): PlanProblem {
  return {
    options: [makeOpt(1, 1, [['C1', 3]])],
    dag: jointDag,
    targets,
    fuelCapacity: 6,
    timeCapacityPerSlot: 4,
    slots: 3,
    baseYield: new Map([['C1', 4]]),
  };
}

describe('the model is a function of the target set, not its order', () => {
  it('reports per-target factors in the order the caller asked for', async () => {
    const solve = await loadHighs();
    const forward = solveWith(problemOf(['A1', 'A2']), solve, DEFAULT_TUNING, { report: true });
    const reversed = solveWith(problemOf(['A2', 'A1']), solve, DEFAULT_TUNING, { report: true });

    // Same plan, same joint — the relabeling moved nothing.
    expect(reversed.allocation).toEqual(forward.allocation);
    expect(reversed.reported!.jointProbability).toBe(forward.reported!.jointProbability);

    // ...but `perTarget` is parallel to the caller's list, so it flips. The two factors differ, so a seam
    // that forgot to map back would return them the wrong way round and this would catch it.
    const [a1, a2] = forward.reported!.perTarget;
    expect(a1).not.toBe(a2);
    expect(reversed.reported!.perTarget).toEqual([a2, a1]);
  });
});
