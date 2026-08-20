// The display layer between a solved plan and the results panel: what counts as one line, what order the
// lines come in, and whether the panel shows a schedule at all.

import { describe, expect, it } from 'vitest';
import { ei, MissionType } from 'lib';

import {
  computeMissionLegendaryRows,
  mergeDisplayRuns,
  planDisplayRuns,
  planHasDoubledRuns,
  slotSchedule,
} from '@/lib';
import type { CapacityVariant, LaunchSolution, OptimizerSolution, SlotSummary } from '@/lib/types';

import Spaceship = ei.MissionInfo.Spaceship;
import DurationType = ei.MissionInfo.DurationType;
import Name = ei.ArtifactSpec.Name;

// A real `MissionType`, not a literal: the merge keys on `missionTypeId`, which is a getter.
const ship = (shipType: Spaceship, durationType: DurationType) => new MissionType(shipType, durationType);

function run(
  shipType: Spaceship,
  durationType: DurationType,
  variant: CapacityVariant,
  numShipsLaunched: number,
  targetAfxId: Name = Name.TACHYON_DEFLECTOR
): LaunchSolution {
  return {
    ship: ship(shipType, durationType),
    variant,
    actualFuel: 0,
    actualFuelByEgg: new Map(),
    actualTime: 3600,
    target: '',
    targetAfxId,
    numShipsLaunched,
    supplyVector: new Map(),
    legendarySupplyVector: new Map(),
  };
}

function solutionOf(...slots: LaunchSolution[][]): OptimizerSolution {
  const summaries: SlotSummary[] = slots.map(runs => ({
    loadSeconds: 0,
    rawLoadSeconds: 0,
    missionCount: runs.reduce((n, r) => n + r.numShipsLaunched, 0),
    runs,
  }));
  return { slots: summaries } as OptimizerSolution;
}

const HEN = Spaceship.HENERPRISE;
const ATREGGIES = Spaceship.ATREGGIES;
const SHORT = DurationType.SHORT;
const EPIC = DurationType.EPIC;

describe('mergeDisplayRuns', () => {
  it('folds repeats of the same mission into one Nx line', () => {
    // The solver emits one run per option group, so a slot can hold several runs of the same mission.
    const rows = mergeDisplayRuns([
      run(HEN, SHORT, 'normal', 3),
      run(HEN, SHORT, 'normal', 5),
      run(HEN, SHORT, 'normal', 1),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].numShipsLaunched).toBe(9);
  });

  it('merges non-adjacent repeats too', () => {
    const rows = mergeDisplayRuns([
      run(HEN, SHORT, 'normal', 2),
      run(ATREGGIES, SHORT, 'normal', 1),
      run(HEN, SHORT, 'normal', 4),
    ]);
    expect(rows.map(r => r.numShipsLaunched)).toEqual([6, 1]);
    // First appearance, not last: the doubled prefix has to stay at the front.
    expect(rows[0].ship.shipType).toBe(HEN);
  });

  it('keeps a doubled launch apart from an identical normal one', () => {
    // They bring home different amounts, so they are two lines.
    const rows = mergeDisplayRuns([run(HEN, SHORT, 'event', 2), run(HEN, SHORT, 'normal', 3)]);
    expect(rows.map(r => [r.doubled, r.numShipsLaunched])).toEqual([
      [true, 2],
      [false, 3],
    ]);
  });

  it('merges event with overhang, which the player cannot act on differently', () => {
    // Both fly doubled; which matrix row bounds them is the solver's business.
    const rows = mergeDisplayRuns([run(HEN, SHORT, 'event', 2), run(HEN, SHORT, 'overhang', 1)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ doubled: true, numShipsLaunched: 3 });
  });

  it('keeps the overhang last when merging pulls it forward', () => {
    // Folding the overhang into the leading row would read as "fly HEN three times, then ATREGGIES", and
    // that ATREGGIES then starts past the window it was priced inside.
    const rows = mergeDisplayRuns([
      run(HEN, SHORT, 'event', 2),
      run(ATREGGIES, SHORT, 'event', 1, Name.BOOK_OF_BASAN),
      run(HEN, SHORT, 'overhang', 1),
    ]);
    expect(rows.map(r => [r.ship.shipType, r.numShipsLaunched])).toEqual([
      [ATREGGIES, 1],
      [HEN, 3],
    ]);
  });

  it('leaves the boundary where it was after sinking the overhang', () => {
    const rows = mergeDisplayRuns([
      run(HEN, SHORT, 'event', 2),
      run(ATREGGIES, SHORT, 'event', 1, Name.BOOK_OF_BASAN),
      run(HEN, SHORT, 'overhang', 1),
      run(HEN, SHORT, 'normal', 5),
    ]);
    expect(rows.map(r => r.doubled)).toEqual([true, true, false]);
  });

  it('leaves an overhang that already sorts last alone', () => {
    const rows = mergeDisplayRuns([
      run(HEN, SHORT, 'event', 2),
      run(ATREGGIES, SHORT, 'overhang', 1, Name.BOOK_OF_BASAN),
    ]);
    expect(rows.map(r => r.ship.shipType)).toEqual([HEN, ATREGGIES]);
  });

  it('keeps different targets apart', () => {
    const rows = mergeDisplayRuns([
      run(HEN, SHORT, 'normal', 2, Name.TACHYON_DEFLECTOR),
      run(HEN, SHORT, 'normal', 2, Name.BOOK_OF_BASAN),
    ]);
    expect(rows).toHaveLength(2);
  });

  it('drops a zero-count run rather than showing a 0x line', () => {
    expect(mergeDisplayRuns([run(HEN, SHORT, 'normal', 0)])).toEqual([]);
  });
});

describe('slotSchedule', () => {
  const slotOf = (...runs: LaunchSolution[]): SlotSummary => ({
    loadSeconds: 0,
    rawLoadSeconds: 0,
    missionCount: 0,
    runs,
  });

  it('offsets each line by the load ahead of it, counting every ship in an Nx line', () => {
    const a = run(HEN, SHORT, 'normal', 3);
    const b = run(ATREGGIES, SHORT, 'normal', 1, Name.BOOK_OF_BASAN);
    expect(slotSchedule(slotOf(a, b)).map(r => r.offsetSeconds)).toEqual([0, 3 * 3600]);
  });

  it('offsets the sunk overhang by where it is flown, not where it was merged', () => {
    // The merge moves this row to the back of the doubled prefix; an offset taken before that would put
    // T+0 on the line the player now flies third.
    const rows = slotSchedule(
      slotOf(
        run(HEN, SHORT, 'event', 2),
        run(ATREGGIES, SHORT, 'event', 1, Name.BOOK_OF_BASAN),
        run(HEN, SHORT, 'overhang', 1)
      )
    );
    expect(rows.map(r => [r.ship.shipType, r.numShipsLaunched, r.offsetSeconds])).toEqual([
      [ATREGGIES, 1, 0],
      [HEN, 2, 3600],
      [HEN, 1, 3 * 3600],
    ]);
  });

  it('peels the last in-window launch onto its own line, so its offset is exact', () => {
    // Stacked, the line would read 'T+0' while its third launch really goes up at T+2h.
    const rows = slotSchedule(slotOf(run(HEN, SHORT, 'event', 3)));
    expect(rows.map(r => [r.numShipsLaunched, r.offsetSeconds])).toEqual([
      [2, 0],
      [1, 2 * 3600],
    ]);
  });

  it('peels from the last doubled line, not the last line in the slot', () => {
    const rows = slotSchedule(slotOf(run(HEN, SHORT, 'event', 2), run(HEN, SHORT, 'normal', 4)));
    expect(rows.map(r => [r.numShipsLaunched, r.doubled])).toEqual([
      [1, true],
      [1, true],
      [4, false],
    ]);
  });

  it('leaves a last doubled line that is already one launch alone', () => {
    const rows = slotSchedule(slotOf(run(HEN, SHORT, 'event', 3), run(ATREGGIES, SHORT, 'overhang', 1)));
    expect(rows.map(r => [r.ship.shipType, r.numShipsLaunched])).toEqual([
      [HEN, 3],
      [ATREGGIES, 1],
    ]);
  });

  it('peels nothing from a slot with no doubled launches', () => {
    const rows = slotSchedule(slotOf(run(HEN, SHORT, 'normal', 5)));
    expect(rows.map(r => r.numShipsLaunched)).toEqual([5]);
  });

  it('starts the first line at zero', () => {
    expect(slotSchedule(slotOf(run(HEN, SHORT, 'event', 1))).map(r => r.offsetSeconds)).toEqual([0]);
  });

  it('has no offsets for an empty slot', () => {
    expect(slotSchedule(slotOf())).toEqual([]);
  });
});

describe('planDisplayRuns', () => {
  it('merges across slots, since with no window the slot a launch sits in is arbitrary', () => {
    const rows = planDisplayRuns(
      solutionOf([run(HEN, SHORT, 'normal', 2)], [run(HEN, SHORT, 'normal', 3)], [run(HEN, SHORT, 'normal', 4)])
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].numShipsLaunched).toBe(9);
  });

  it('sorts by ship then duration rather than leaving slot order', () => {
    const rows = planDisplayRuns(
      solutionOf([run(HEN, EPIC, 'normal', 1), run(ATREGGIES, SHORT, 'normal', 1)], [run(HEN, SHORT, 'normal', 1)])
    );
    expect(rows.map(r => [r.ship.shipType, r.ship.durationType])).toEqual([
      [HEN, SHORT],
      [HEN, EPIC],
      [ATREGGIES, SHORT],
    ]);
  });
});

describe('computeMissionLegendaryRows', () => {
  const ROOT = 'tachyon-deflector-4';
  const dropping = (variant: CapacityVariant, n: number, rate: number) => {
    const r = run(HEN, SHORT, variant, n);
    r.legendarySupplyVector = new Map([[ROOT, rate]]);
    return r;
  };

  it('shows one row per mission per capacity, not one per matrix variant', () => {
    // `event` and `overhang` both fly doubled and drop at the same rate.
    const rows = computeMissionLegendaryRows(
      solutionOf([dropping('event', 1, 0.12), dropping('overhang', 3, 0.12)], [], []),
      ROOT
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].numShipsLaunched).toBe(4);
    expect(rows[0].legendaryDrops).toBeCloseTo(0.48, 10);
    expect(rows[0].doubled).toBe(true);
  });

  it('still splits doubled from normal, which really do drop differently', () => {
    const rows = computeMissionLegendaryRows(
      solutionOf([dropping('event', 1, 0.12)], [dropping('normal', 1, 0.06)], []),
      ROOT
    );
    expect(rows.map(r => r.doubled)).toEqual([true, false]);
  });

  it('drops a mission that contributes nothing to this target', () => {
    expect(computeMissionLegendaryRows(solutionOf([dropping('normal', 1, 0)], [], []), ROOT)).toEqual([]);
  });
});

describe('planHasDoubledRuns', () => {
  it('is false for a plan with no event, which is what hides the schedule', () => {
    expect(planHasDoubledRuns(solutionOf([run(HEN, SHORT, 'normal', 2)], [], []))).toBe(false);
  });

  it('is false when a window was given but nothing fit inside it', () => {
    // An event with an hour left and no mission under an hour produces an ordinary plan.
    expect(planHasDoubledRuns(solutionOf([run(HEN, EPIC, 'normal', 1)], [], []))).toBe(false);
  });

  it('is true from a single doubled launch in any slot', () => {
    expect(planHasDoubledRuns(solutionOf([], [], [run(HEN, SHORT, 'overhang', 1)]))).toBe(true);
  });
});
