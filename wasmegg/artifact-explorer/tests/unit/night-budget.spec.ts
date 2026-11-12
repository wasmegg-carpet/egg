// The night budget: `PlanProblem.nightsPerSlot` and `LaunchOption.nights` in the model, the duration classes,
// the `night_k` rows and the certifier. See `src/lib/solver/SPEC.md` section 9.

import { describe, expect, it } from 'vitest';
import { buildModel } from '@/lib/solver/model';
import { buildOaMilp, effectiveQs, layoutOf } from '@/lib/solver/milp';
import { DEFAULT_TUNING, solveWith } from '@/lib/solver/solve';
import { loadHighs } from '@/lib/solver/highs';
import { craftDag, makeOpt } from './spec-helpers';
import type { PlanProblem } from '@/lib/solver/types';
import type { LaunchOption } from '@/lib/types';

function withNights(opt: LaunchOption, nights: number): LaunchOption {
  return { ...opt, nights };
}

function problemOf(options: LaunchOption[], extra: Partial<PlanProblem> = {}): PlanProblem {
  return {
    options,
    dag: craftDag(0.1),
    targets: ['A'],
    fuelCapacity: 1000,
    timeCapacityPerSlot: 1000,
    slots: 3,
    ownedStock: new Map<string, number>(),
    ...extra,
  };
}

describe('the night budget in the model', () => {
  it('does not prune a daytime variant by its overnight twin', () => {
    // The overnight twin charges fewer waking seconds, but spends a night the daytime one does not.
    const model = buildModel(
      problemOf([withNights(makeOpt(1, 600, [['B', 1]]), 0), withNights(makeOpt(1, 100, [['B', 1]]), 1)], {
        nightsPerSlot: 2,
      })
    );
    expect(model.groups.map(g => g.nights).sort()).toEqual([0, 1]);
  });

  it('prunes an overnight variant its daytime twin beats on seconds and nights alike', () => {
    const model = buildModel(
      problemOf([withNights(makeOpt(1, 100, [['B', 1]]), 0), withNights(makeOpt(1, 100, [['B', 1]]), 1)], {
        nightsPerSlot: 2,
      })
    );
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].nights).toBe(0);
    expect(model.groups[0].members).toEqual([0]);
  });

  it('drops an option spending more nights than a slot has', () => {
    const options = [withNights(makeOpt(1, 100, [['B', 1]]), 2), withNights(makeOpt(1, 100, [['B', 1]]), 1)];
    const model = buildModel(problemOf(options, { nightsPerSlot: 1 }));
    expect(model.groups.map(g => g.members)).toEqual([[1]]);
  });

  it('drops every overnight option when the problem has no sleep window', () => {
    const options = [withNights(makeOpt(1, 0, [['B', 1]]), 1), makeOpt(1, 100, [['B', 1]])];
    const model = buildModel(problemOf(options));
    expect(model.nightsPerSlot).toBe(0);
    expect(model.groups.map(g => g.members)).toEqual([[1]]);
  });

  it('keeps a zero-second overnight launch, shares its class and bounds it by the night row', () => {
    // A short ship sent at bedtime: no waking seconds, one night. It must survive, sit in a shared class
    // (so it can stand in for others), and be capped by nights rather than by a stand-in.
    const options = [withNights(makeOpt(1, 0, [['B', 2]]), 1), withNights(makeOpt(1, 100, [['B', 1]]), 1)];
    const model = buildModel(problemOf(options, { nightsPerSlot: 4 }));
    // The zero-second launch dominates the other: it is admitted as a dominator.
    expect(model.groups.map(g => g.members)).toEqual([[0]]);
    expect(model.groups[0].cap).toBe(12);
    const layout = layoutOf(model, 'oa');
    expect(layout.classSeconds).toEqual([0]);
    expect(layout.classNights).toEqual([1]);
    expect(layout.classCap).toEqual([4]);
  });
});

describe('the night budget in the MILP', () => {
  it('flies the zero-second overnight launch exactly as often as there are nights', async () => {
    const solve = await loadHighs();
    const problem = problemOf([withNights(makeOpt(1, 0, [['B', 1]]), 1)], { nightsPerSlot: 4 });
    const result = solveWith(problem, solve, DEFAULT_TUNING);
    expect(result.allocation).toEqual([12]);
  });

  it('binds: spends each slot’s nights on the launch that yields most per night', async () => {
    // Waking seconds are no constraint here; nights are. Two one-night launches yield 2, one two-night
    // launch yields 3, so each slot's two nights go to the two-night launch.
    const solve = await loadHighs();
    const problem = problemOf([withNights(makeOpt(1, 0, [['B', 1]]), 1), withNights(makeOpt(1, 0, [['B', 3]]), 2)], {
      nightsPerSlot: 2,
    });
    const result = solveWith(problem, solve, DEFAULT_TUNING);
    expect(result.allocation).toEqual([0, 3]);
  });

  it('mixes daytime and overnight launches up to both budgets at once', async () => {
    const solve = await loadHighs();
    const problem = problemOf(
      [withNights(makeOpt(1, 500, [['B', 1]]), 0), withNights(makeOpt(1, 400, [['B', 1]]), 1)],
      {
        nightsPerSlot: 1,
      }
    );
    const result = solveWith(problem, solve, DEFAULT_TUNING);
    // Per slot: one night (one overnight launch, 400 s) and 600 s left (one daytime launch).
    expect(result.allocation).toEqual([3, 3]);
  });
});

describe('a problem without a sleep window builds today’s model', () => {
  const menu = (): LaunchOption[] => [
    makeOpt(2, 20, [['B', 1]]),
    makeOpt(1, 30, [['B', 2]]),
    makeOpt(3, 0, [['B', 4]]),
    makeOpt(1, 30, [['B', 2]]),
    makeOpt(5, 300, [['B', 9]]),
  ];

  function milpOf(problem: PlanProblem) {
    const model = buildModel(problem);
    const qs = effectiveQs(model);
    return { model, milp: buildOaMilp(model, qs, [1], DEFAULT_TUNING.sigmaGrid) };
  }

  it('writes no night row and keys classes by duration alone', () => {
    const { model, milp } = milpOf(problemOf(menu()));
    expect(milp.rowNames.some(name => name.startsWith('night_'))).toBe(false);
    const layout = layoutOf(model, 'oa');
    expect(layout.classNights.every(n => n === 0)).toBe(true);
    // One class per duration (the two 30-second options merge into one group), the zero-second group in a
    // private class of its own, as before.
    expect([...layout.classSeconds].sort((a, b) => a - b)).toEqual([0, 20, 30, 300]);
  });

  it('matches, matrix for matrix, the same menu with explicit zero nights and a zero night budget', () => {
    const today = milpOf(problemOf(menu())).milp;
    const zeroNights = milpOf(
      problemOf(
        menu().map(o => withNights(o, 0)),
        { nightsPerSlot: 0 }
      )
    ).milp;
    expect(zeroNights).toEqual(today);
  });
});
