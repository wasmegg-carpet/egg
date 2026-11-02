// The joint (product) objective at the one place it is a promise to the caller rather than a property of
// the linearization. See OPTIMIZER.md.

import { describe, it, expect } from 'vitest';
import { optimizeFull } from '@/lib/optimizer-core';
import { buildModel } from '@/lib/solver/model';
import { simplexMax } from '@/lib/solver/simplex';
import { craftDag, makeOpt } from './spec-helpers';

describe('the product objective reduces to the linear score at n=1', () => {
  // Independent here is the sweep over craft counts k below, not the LP: the polytope and the solver
  // are the same production pair `optimizeFull` reaches through the judge. What this checks is that
  // optimizeFull's search reduces to "take the best k by hand-sweeping the LP," not that the LP is right.
  const dag = craftDag(0.1);
  const opt = makeOpt(10, 10, [['B', 1]]);
  const args = {
    options: [opt],
    recipeDag: dag,
    desiredArtifactNodeIds: ['A'],
    fuelCapacity: 65,
    timeCapacityPerSlot: 40,
    ownedStock: new Map<string, number>(),
    maximumCost: Infinity,
  };

  // The craft-conservation polytope at an inventory of k of the leaf, maximized on A's craft column.
  const maxCrafts = (k: number) => {
    const model = buildModel({
      options: [],
      dag,
      targets: ['A'],
      fuelCapacity: 0,
      timeCapacityPerSlot: 0,
      slots: 3,
      ownedStock: new Map([['B', k]]),
    });
    const c = model.craftables.map((_, i) => (i === model.targetCraftIdx[0] ? 1 : 0));
    return simplexMax(model.consRows, model.baseInventoryByItem, c).objective;
  };

  it('lands on the plain linear score optimum', async () => {
    const sol = await optimizeFull(args);

    const Q = -Math.log(1 - 0.1);
    const perSlot = Math.floor(args.timeCapacityPerSlot / opt.actualTime);
    const maxK = Math.min(Math.floor(args.fuelCapacity / opt.actualFuel), 3 * perSlot);
    let bestScore = 0;
    for (let k = 0; k <= maxK; k++) {
      if (k > 3 * perSlot) continue;
      bestScore = Math.max(bestScore, Q * maxCrafts(k));
    }

    expect(sol.bestProbability).toBeCloseTo(1 - Math.exp(-bestScore), 9);
  });

  it('reports jointProbability as that one target’s own probability', async () => {
    // The card prints both, so at a single target they have to agree.
    const sol = await optimizeFull(args);
    expect(sol.perTarget).toHaveLength(1);
    expect(sol.jointProbability).toBeCloseTo(sol.bestProbability, 12);
  });
});
