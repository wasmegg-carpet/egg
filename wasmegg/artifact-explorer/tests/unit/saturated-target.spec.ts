// A target so easy that the plan's score on it could run to thousands: the tangent grid laid over that ceiling has
// no slope left at its floor, and before `extendedGrid` the MILP saw nothing to gain from launching at all. See
// `lib/mission-optimizer/solver/SPEC.md` section 15.

import { describe, expect, it } from 'vitest';
import { optimizeFull } from 'lib/mission-optimizer/optimizer-core';
import { DEEPEST_CUT_SCORE, FLAT_FLOOR_SCORE, extendedGrid } from 'lib/mission-optimizer/solver/milp';
import { DEFAULT_TUNING } from 'lib/mission-optimizer/solver/solve';
import { craftDag, makeOpt } from './spec-helpers';

const floor = Math.min(...DEFAULT_TUNING.sigmaGrid);

describe('the tangent grid of a saturated target', () => {
  it('is the grid itself while its floor is low enough on the curve', () => {
    expect(extendedGrid(DEFAULT_TUNING.sigmaGrid, FLAT_FLOOR_SCORE / floor)).toBe(DEFAULT_TUNING.sigmaGrid);
    expect(extendedGrid(DEFAULT_TUNING.sigmaGrid, 1e-7)).toBe(DEFAULT_TUNING.sigmaGrid);
  });

  it('continues below its floor, at its own spacing, down to the deepest cut score', () => {
    const theta = 8192;
    const grid = extendedGrid(DEFAULT_TUNING.sigmaGrid, theta);
    expect(grid.slice(0, DEFAULT_TUNING.sigmaGrid.length)).toEqual(DEFAULT_TUNING.sigmaGrid);
    const extra = grid.slice(DEFAULT_TUNING.sigmaGrid.length);
    const step = DEFAULT_TUNING.sigmaGrid[49] / DEFAULT_TUNING.sigmaGrid[48];
    expect(extra[0] / floor).toBeCloseTo(step, 12);
    expect(theta * extra[extra.length - 1]).toBeLessThanOrEqual(DEEPEST_CUT_SCORE);
    expect(theta * extra[extra.length - 2]).toBeGreaterThan(DEEPEST_CUT_SCORE);
  });
});

describe('ten- and forty-second ships over three days', () => {
  // Thousands of launches a slot, each worth a score of 0.1 on the one target: the plan is certain long before the
  // slots are full, and must not come back empty at probability 0, sleep window or 2x window or neither (SPEC.md
  // section 15).
  const settings = [
    {},
    { sleepSeconds: 8 * 3600 },
    { eventWindowSeconds: 3600 },
    { sleepSeconds: 8 * 3600, eventWindowSeconds: 10 * 3600 },
  ];
  for (const extra of settings) {
    it(`plans launches and a joint near 1 (${JSON.stringify(extra)})`, async () => {
      const options = [makeOpt(1, 10, [['B', 1]]), makeOpt(1, 40, [['B', 2]])];
      const sol = await optimizeFull({
        options,
        recipeDag: craftDag(0.1),
        desiredArtifactNodeIds: ['A'],
        fuelCapacity: 1e9,
        timeCapacityPerSlot: 3 * 86400,
        maximumCost: undefined,
        ownedStock: new Map(),
        ...extra,
      });
      expect(sol.choiceHistory.length).toBeGreaterThan(0);
      expect(sol.jointProbability).toBeGreaterThan(0.999);
    });
  }
});
