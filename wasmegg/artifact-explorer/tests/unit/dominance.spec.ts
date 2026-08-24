// Dominance pruning in `buildModel`: what it drops, and the variant rule that decides what is comparable
// at all. See `src/lib/solver/SPEC.md` section 1.

import { describe, expect, it } from 'vitest';
import { ei } from 'lib';
import { buildModel } from '@/lib/solver/model';
import { craftDag, makeOpt } from './spec-helpers';
import type { PlanProblem } from '@/lib/solver/types';
import type { LaunchOption } from '@/lib/types';

const UNKNOWN = ei.ArtifactSpec.Name.UNKNOWN;

function modelOf(options: LaunchOption[], eventWindowSeconds = 0) {
  return buildModel({
    options,
    dag: craftDag(0.1),
    targets: ['A'],
    fuelCapacity: 100,
    timeCapacityPerSlot: 1000,
    slots: 3,
    baseYield: new Map<string, number>(),
    eventWindowSeconds,
  } satisfies PlanProblem);
}

describe('dominance pruning', () => {
  it('drops an option another beats on every axis', () => {
    const model = modelOf([makeOpt(2, 20, [['B', 1]]), makeOpt(1, 10, [['B', 2]])]);
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].members).toEqual([1]);
  });

  it('keeps an option that buys its extra yield with extra cost', () => {
    const model = modelOf([makeOpt(1, 10, [['B', 1]]), makeOpt(2, 20, [['B', 5]])]);
    expect(model.groups).toHaveLength(2);
  });

  it('leaves all three capacity variants of one flight standing', () => {
    // The doubled pair is identical in fuel, duration and yield and differs only in which row holds it,
    // and neither of those rows implies the other; the 1x column is what they are constrained against.
    const model = modelOf(
      [
        makeOpt(1, 10, [['B', 1]], [], UNKNOWN, 'normal'),
        makeOpt(1, 10, [['B', 2]], [], UNKNOWN, 'event'),
        makeOpt(1, 10, [['B', 2]], [], UNKNOWN, 'overhang'),
      ],
      3600
    );
    expect(model.groups.map(g => g.variant).sort()).toEqual(['event', 'normal', 'overhang']);
  });

  it('lets a `normal` absorb a doubled column it beats outright, and never the other way round', () => {
    const absorbed = modelOf(
      [makeOpt(1, 10, [['B', 3]], [], UNKNOWN, 'normal'), makeOpt(2, 10, [['B', 2]], [], UNKNOWN, 'event')],
      3600
    );
    expect(absorbed.groups.map(g => g.variant)).toEqual(['normal']);

    // Same pair with the advantage the other way: the `event` column wins on both axes and still cannot
    // stand in for the `normal` one, because flying it spends a window budget the 1x launch never did.
    const kept = modelOf(
      [makeOpt(2, 10, [['B', 2]], [], UNKNOWN, 'normal'), makeOpt(1, 10, [['B', 3]], [], UNKNOWN, 'event')],
      3600
    );
    expect(kept.groups).toHaveLength(2);
  });

  it('refuses a dominator whose per-slot count no row bounds', () => {
    // A zero-duration launch beats the other on every axis, but the slot row says nothing about how many
    // of it fit, so absorbing could walk its column past the stand-in cap that does.
    const model = modelOf([makeOpt(1, 0, [['B', 5]]), makeOpt(2, 10, [['B', 1]])]);
    expect(model.groups).toHaveLength(2);
  });

  it('drops the same groups whichever order the menu arrives in', () => {
    const menu: LaunchOption[] = [
      makeOpt(2, 20, [['B', 1]]),
      makeOpt(1, 10, [['B', 2]]),
      makeOpt(3, 5, [['B', 2]]),
      makeOpt(1, 10, [['B', 1]]),
    ];
    const key = (m: ReturnType<typeof modelOf>) =>
      m.groups.map(g => [g.fuelFraction, g.timeSeconds, g.variant, ...g.yieldByItem].join(','));

    const forward = key(modelOf(menu));
    expect(forward.length).toBeLessThan(menu.length);
    expect(key(modelOf([...menu].reverse()))).toEqual(forward);
  });
});
