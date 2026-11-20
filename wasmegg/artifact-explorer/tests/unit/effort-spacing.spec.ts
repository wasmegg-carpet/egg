// The effort level spaces launches and nothing else (`lib/mission-optimizer/solver/SPEC.md` section 19): consecutive
// launches in a slot go up at least the launch period apart, and a slot's last launch only has to land by the horizon.
// The arena states the same rule independently (`tests/arena/capacity.ts`, `lastVariants`, and `calendar.ts`).

import { describe, expect, it } from 'vitest';

import { optimizeFull } from 'lib/mission-optimizer/optimizer-core';
import { lastVariants } from 'lib/mission-optimizer/last-launch';
import { slotFault } from 'lib/mission-optimizer/solver/verify';
import type { LaunchOption } from 'lib/mission-optimizer/types';
import { lastVariants as arenaLastVariants } from '../arena/capacity';
import { calendarFaults } from '../arena/calendar';
import { craftDag, makeOpt } from './spec-helpers';

const H = 3600;
const LOW = 24 * H;

// A four-hour mission at Low effort: floored to a day, its real flight four hours.
const lowShip = (): LaunchOption => ({ ...makeOpt(100, LOW, [['B', 1]]), rawTime: 4 * H });

const args = (horizon: number, extra: Record<string, unknown> = {}) => ({
  options: [lowShip()],
  recipeDag: craftDag(0.1),
  desiredArtifactNodeIds: ['A'],
  fuelCapacity: 1e9,
  timeCapacityPerSlot: horizon,
  ownedStock: new Map<string, number>(),
  maximumCost: undefined,
  ...extra,
});

describe('a slot’s last launch', () => {
  it('is offered once more at its real flight, and only for a launch the floor lengthens', () => {
    const ship = lowShip();
    const [last] = lastVariants([ship]);
    expect(last).toMatchObject({ actualTime: 4 * H, rawTime: 4 * H, lastInSlot: true });
    expect(last.id.endsWith('~last')).toBe(true);
    expect(lastVariants([makeOpt(1, 4 * H, [['B', 1]])])).toEqual([]);
    expect(arenaLastVariants([ship]).map(o => [o.id, o.actualTime])).toEqual([[last.id, last.actualTime]]);
  });

  it('makes a one-day Low plan fly a launch a slot', async () => {
    for (const fuelingRate of [undefined, 10]) {
      const plan = await optimizeFull(args(LOW, fuelingRate === undefined ? {} : { fuelingRate }));
      expect(plan.slots!.map(s => s.launches.length)).toEqual([1, 1, 1]);
    }
  });

  it('flies two a slot over 36 hours at Low, a day apart, the second landing by the horizon', async () => {
    const plan = await optimizeFull(args(36 * H));
    for (const slot of plan.slots!) {
      expect(slot.launches).toHaveLength(2);
      expect(slot.launches[1].launchAt - slot.launches[0].launchAt).toBeGreaterThanOrEqual(LOW);
      expect(slot.launches[1].launchAt + 4 * H).toBeLessThanOrEqual(36 * H);
    }
  });

  it('flies one a slot when a second could not land by the horizon', async () => {
    const plan = await optimizeFull(args(26 * H));
    expect(plan.slots!.map(s => s.launches.length)).toEqual([1, 1, 1]);
  });
});

describe('the verifier and the arena on the effort level', () => {
  const sleep = { sleepSeconds: 0, horizonSeconds: 36 * H };
  const floored = { wakingSeconds: LOW, nights: 0, flightSeconds: 4 * H };
  const menu = [
    { id: 'low', actualTime: LOW, rawTime: 4 * H },
    { id: 'low~last', actualTime: 4 * H, rawTime: 4 * H, lastInSlot: true },
  ];
  const arena = (launches: [number, number][], horizon = 36 * H) =>
    calendarFaults(
      [launches.map(([option, launchAt]) => ({ option, optionId: menu[option].id, launchAt }))],
      menu,
      menu.map((_, i) => launches.filter(([o]) => o === i).length),
      { sleepSeconds: 0, horizonSeconds: horizon, slots: 1 }
    );

  it('holds the last launch to its real flight landing by the horizon', () => {
    expect(
      slotFault(
        [
          { launchAt: 0, ...floored },
          { launchAt: LOW, ...floored },
        ],
        sleep
      )
    ).toBeNull();
    expect(
      slotFault(
        [
          { launchAt: 0, ...floored },
          { launchAt: 33 * H, ...floored },
        ],
        sleep
      )
    ).toMatch(/lands at/);
    expect(
      arena([
        [0, 0],
        [0, LOW],
      ])
    ).toEqual([]);
    expect(
      arena([
        [0, 0],
        [0, 33 * H],
      ]).join('\n')
    ).toMatch(/lands at/);
    // Without the real flight, the block, as before.
    expect(
      slotFault(
        [
          { launchAt: 0, wakingSeconds: LOW, nights: 0 },
          { launchAt: LOW, wakingSeconds: LOW, nights: 0 },
        ],
        sleep
      )
    ).toMatch(/past the/);
  });

  it('still spaces launches by the period, and lets nothing follow a last-launch variant', () => {
    expect(
      slotFault(
        [
          { launchAt: 0, ...floored },
          { launchAt: 23 * H, ...floored },
        ],
        sleep
      )
    ).toMatch(/overlaps/);
    expect(
      arena([
        [0, 0],
        [0, 23 * H],
      ]).join('\n')
    ).toMatch(/before the slot is free/);
    const last = { launchAt: 0, wakingSeconds: 4 * H, nights: 0, flightSeconds: 4 * H, lastInSlot: true };
    expect(slotFault([last, { launchAt: LOW, ...floored }], sleep)).toMatch(/last launch/);
    expect(
      arena([
        [1, 0],
        [0, LOW],
      ]).join('\n')
    ).toMatch(/last launch/);
  });
});
