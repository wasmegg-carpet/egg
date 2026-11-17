// The display views the solution card and the ascension planner's panel read off a solution: the totals, the
// legendary sources and the per-slot timeline. Hand-built solutions pin the layout rules; real solves check the
// one property the card leans on, that the timeline and the totals count the same launches.

import { describe, it, expect } from 'vitest';
import { ei, MissionType } from 'lib';
import {
  computeMissionLegendaryRows,
  finalizeSolutions,
  isDoubled,
  launchTotals,
  planTimeline,
  type TimelineLaunchRow,
  type TimelineRow,
} from 'lib/mission-optimizer';
import { optimizeFull } from 'lib/mission-optimizer/optimizer-core';
import type { CapacityVariant, LaunchSolution, OptimizerSolution, SlotLaunch } from 'lib/mission-optimizer/types';
import { lt1, lt2, makeNode, makeOpt, makeSolution } from './spec-helpers';

const Ship = ei.MissionInfo.Spaceship;
const Duration = ei.MissionInfo.DurationType;
const Name = ei.ArtifactSpec.Name;
const H = 3600;
const DAY = 24 * H;

function choice(
  ship: ei.MissionInfo.Spaceship,
  count: number,
  extra: { variant?: CapacityVariant; nights?: number; target?: ei.ArtifactSpec.Name; legendary?: number } = {}
): LaunchSolution {
  return {
    ship: new MissionType(ship, Duration.SHORT),
    actualFuel: 0,
    actualFuelByEgg: new Map(),
    actualTime: H,
    ...(extra.nights !== undefined && { nights: extra.nights }),
    ...(extra.variant !== undefined && { variant: extra.variant }),
    target: '',
    targetAfxId: extra.target ?? Name.UNKNOWN,
    numShipsLaunched: count,
    supplyVector: new Map(),
    legendarySupplyVector: new Map(extra.legendary ? [['A', extra.legendary]] : []),
  };
}

// One slot's launches as `[choice, launchAt, doubled]`.
const slot = (...launches: [number, number, boolean?][]) => {
  const list: SlotLaunch[] = launches.map(([c, launchAt, doubled]) => ({ choice: c, launchAt, doubled: !!doubled }));
  const last = list[list.length - 1];
  return { loadSeconds: last ? last.launchAt + H : 0, rawLoadSeconds: 0, missionCount: list.length, launches: list };
};

const launchRows = (rows: TimelineRow[]) => rows.filter((r): r is TimelineLaunchRow => r.kind === 'launch');
const shape = (rows: TimelineRow[]) =>
  rows.map(r =>
    r.kind === 'launch'
      ? `${r.count}x${r.repeat > 1 ? `*${r.repeat}` : ''}@${r.launchAt}${r.doubled ? ' 2x' : ''}${r.nights ? ' night' : ''}`
      : r.kind === 'day'
        ? `day ${r.firstDay}-${r.lastDay}`
        : `ends ${r.at}`
  );

// For each entry, what the timeline counts of it, against the entry's own count.
function timelineCounts(solution: OptimizerSolution): number[] {
  const counts = solution.choiceHistory.map(() => 0);
  for (const s of planTimeline(solution).slots)
    for (const row of launchRows(s.rows)) counts[solution.choiceHistory.indexOf(row.choice)] += row.count * row.repeat;
  return counts;
}

describe('launchTotals', () => {
  it("folds a mission's event and overhang variants into one 2x line, apart from its 1x line", () => {
    const solution = makeSolution({
      choiceHistory: [
        choice(Ship.CHICKEN_ONE, 3, { variant: 'normal' }),
        choice(Ship.CHICKEN_ONE, 2, { variant: 'event' }),
        choice(Ship.CHICKEN_ONE, 1, { variant: 'overhang' }),
      ],
    });
    expect(launchTotals(solution).map(l => [l.numShipsLaunched, l.doubled])).toEqual([
      [3, false],
      [3, true],
    ]);
  });

  it('keeps daytime and overnight launches of one mission apart, daytime first', () => {
    const solution = makeSolution({
      choiceHistory: [choice(Ship.CHICKEN_ONE, 1, { nights: 1 }), choice(Ship.CHICKEN_ONE, 4, { nights: 0 })],
    });
    expect(launchTotals(solution).map(l => [l.numShipsLaunched, l.nights])).toEqual([
      [4, 0],
      [1, 1],
    ]);
  });

  it('reads a plan made without either window as 1x and daytime', () => {
    const [line] = launchTotals(makeSolution({ choiceHistory: [choice(Ship.CHICKEN_ONE, 2)] }));
    expect(line).toMatchObject({ numShipsLaunched: 2, nights: 0, doubled: false });
    expect(isDoubled({})).toBe(false);
  });
});

describe('computeMissionLegendaryRows', () => {
  it('keeps a doubled source apart from the same mission at 1x', () => {
    const solution = makeSolution({
      choiceHistory: [
        choice(Ship.CHICKEN_ONE, 4, { variant: 'normal', legendary: 0.01 }),
        choice(Ship.CHICKEN_ONE, 2, { variant: 'event', legendary: 0.02 }),
        choice(Ship.CHICKEN_ONE, 1, { variant: 'overhang', legendary: 0.02 }),
      ],
    });
    const rows = computeMissionLegendaryRows(solution, 'A');
    expect(rows.map(r => [r.numShipsLaunched, r.doubled])).toEqual([
      [4, false],
      [3, true],
    ]);
    expect(rows[1].legendaryDrops).toBeCloseTo(0.06, 12);
  });

  it('still folds daytime and overnight launches of a mission into one source', () => {
    const solution = makeSolution({
      choiceHistory: [
        choice(Ship.CHICKEN_ONE, 2, { nights: 0, legendary: 0.01 }),
        choice(Ship.CHICKEN_ONE, 1, { nights: 1, legendary: 0.01 }),
      ],
    });
    expect(computeMissionLegendaryRows(solution, 'A').map(r => r.numShipsLaunched)).toEqual([3]);
  });
});

describe('planTimeline', () => {
  it('collapses consecutive identical launches and keeps the T+ of the first', () => {
    const solution = makeSolution({
      choiceHistory: [choice(Ship.CHICKEN_ONE, 3), choice(Ship.CHICKEN_NINE, 1)],
      slots: [slot([0, 0], [0, H], [1, 2 * H], [0, 3 * H])],
    });
    // The third launch of entry 0 is not next to the others, so it is its own line.
    expect(shape(planTimeline(solution).slots[0].rows)).toEqual(['2x@0', `1x@${2 * H}`, `1x@${3 * H}`]);
  });

  it('puts the window divider before the first launch after it, and under a slot that never leaves it', () => {
    const solution = makeSolution({
      eventWindowSeconds: 2 * H,
      choiceHistory: [
        choice(Ship.CHICKEN_ONE, 3, { variant: 'event' }),
        choice(Ship.CHICKEN_ONE, 2, { variant: 'normal' }),
      ],
      slots: [slot([0, 0, true], [0, H, true], [0, 2 * H, true], [1, 3 * H], [1, 4 * H]), slot()],
    });
    const timeline = planTimeline(solution);
    expect(timeline.eventWindowSeconds).toBe(2 * H);
    // A launch exactly at the window's end is still inside it.
    expect(shape(timeline.slots[0].rows)).toEqual([`3x@0 2x`, `ends ${2 * H}`, `2x@${3 * H}`]);
    expect(timeline.slots[1].rows).toEqual([]);

    const inside = makeSolution({
      eventWindowSeconds: 10 * H,
      choiceHistory: [choice(Ship.CHICKEN_ONE, 2, { variant: 'event' })],
      slots: [slot([0, 0, true], [0, H, true])],
    });
    expect(shape(planTimeline(inside).slots[0].rows)).toEqual(['2x@0 2x', `ends ${10 * H}`]);
  });

  it('splits a doubled run from a 1x run of the same entry', () => {
    // The calendar says per launch whether it flew doubled; a run never mixes the two.
    const solution = makeSolution({
      eventWindowSeconds: 5 * H,
      choiceHistory: [choice(Ship.CHICKEN_ONE, 3, { variant: 'event' })],
      slots: [slot([0, 0, true], [0, H, true], [0, 2 * H, false])],
    });
    expect(shape(planTimeline(solution).slots[0].rows)).toEqual(['2x@0 2x', `1x@${2 * H}`, `ends ${5 * H}`]);
  });

  it('heads each day on a sleep-aware plan and folds identical days into a block', () => {
    const day = (d: number): [number, number][] => [
      [0, d * DAY],
      [0, d * DAY + H],
      [1, d * DAY + 15 * H],
    ];
    const solution = makeSolution({
      sleepSeconds: 8 * H,
      choiceHistory: [choice(Ship.CHICKEN_ONE, 9, { nights: 0 }), choice(Ship.CHICKEN_NINE, 4, { nights: 1 })],
      // Days 0-2 alike, day 3 different, day 5 like the first ones but not next to them.
      slots: [
        slot(...day(0), ...day(1), ...day(2), [0, 3 * DAY], [0, 5 * DAY], [0, 5 * DAY + H], [1, 5 * DAY + 15 * H]),
      ],
    });
    const timeline = planTimeline(solution);
    expect(timeline.byDay).toBe(true);
    expect(shape(timeline.slots[0].rows)).toEqual([
      'day 0-2',
      '2x*3@0',
      `1x*3@${15 * H} night`,
      'day 3-3',
      `1x@${3 * DAY}`,
      'day 5-5',
      `2x@${5 * DAY}`,
      `1x@${5 * DAY + 15 * H} night`,
    ]);
    expect(timelineCounts(solution)).toEqual([9, 4]);
  });

  it('puts a divider that falls overnight between the two days, and folds no day across it', () => {
    const solution = makeSolution({
      sleepSeconds: 8 * H,
      eventWindowSeconds: 20 * H,
      choiceHistory: [
        choice(Ship.CHICKEN_ONE, 2, { nights: 0, variant: 'event' }),
        choice(Ship.CHICKEN_ONE, 2, { nights: 0 }),
      ],
      slots: [slot([0, 0, true], [0, H, true], [1, DAY], [1, DAY + H])],
    });
    expect(shape(planTimeline(solution).slots[0].rows)).toEqual([
      'day 0-0',
      '2x@0 2x',
      `ends ${20 * H}`,
      'day 1-1',
      `2x@${DAY}`,
    ]);
  });

  it('follows its entries to where finalizeSolutions sorts them', () => {
    const solution = makeSolution({
      choiceHistory: [choice(Ship.HENERPRISE, 1), choice(Ship.CHICKEN_ONE, 2)],
      slots: [slot([0, 0], [1, H], [1, 2 * H])],
    });
    const [sorted] = finalizeSolutions([solution], new Map());
    expect(sorted.choiceHistory.map(c => c.ship.shipType)).toEqual([Ship.CHICKEN_ONE, Ship.HENERPRISE]);
    const rows = launchRows(planTimeline(sorted).slots[0].rows);
    expect(rows.map(r => [r.choice.ship.shipType, r.count])).toEqual([
      [Ship.HENERPRISE, 1],
      [Ship.CHICKEN_ONE, 2],
    ]);
  });
});

// The same views off a real solve, so the calendar's indices and the entries they name are the solver's.
describe('the timeline of a solved plan', () => {
  // Real ids, because `finalizeSolutions` names every dropped item.
  const dag = () =>
    new Map([
      [lt2, makeNode(lt2, false, [[lt1, 2]], 0.05)],
      [lt1, makeNode(lt1, true)],
    ]);
  const menu = () => [
    makeOpt(1, H, [[lt1, 1]], [], Name.LUNAR_TOTEM),
    makeOpt(1, 3 * H, [[lt1, 4]], [], Name.TUNGSTEN_ANKH),
    makeOpt(1, 10 * H, [[lt1, 15]], [], Name.PUZZLE_CUBE),
  ];
  const solve = async (extra: { sleepSeconds?: number; eventWindowSeconds?: number }, horizon: number) =>
    finalizeSolutions(
      [
        await optimizeFull({
          options: menu(),
          recipeDag: dag(),
          desiredArtifactNodeIds: [lt2],
          fuelCapacity: 1000,
          timeCapacityPerSlot: horizon,
          ownedStock: new Map(),
          maximumCost: undefined,
          ...extra,
        }),
      ],
      dag()
    )[0];

  const consistent = (solution: OptimizerSolution) => {
    expect(solution.slots?.length).toBe(3);
    expect(timelineCounts(solution)).toEqual(solution.choiceHistory.map(c => c.numShipsLaunched));
    const totalLaunches = launchTotals(solution).reduce((n, line) => n + line.numShipsLaunched, 0);
    const slotLaunches = solution.slots!.reduce((n, s) => n + s.launches.length, 0);
    expect(slotLaunches).toBe(totalLaunches);
    for (const s of solution.slots!) expect(s.launches.length).toBe(s.missionCount);
  };

  it('counts what the totals count, around the clock', async () => {
    const solution = await solve({}, 2 * DAY);
    expect(solution.choiceHistory.length).toBeGreaterThan(0);
    consistent(solution);
  });

  it('counts what the totals count with a sleep window, and heads its days', async () => {
    const solution = await solve({ sleepSeconds: 8 * H }, 3 * DAY);
    consistent(solution);
    expect(planTimeline(solution).slots.some(s => s.rows[0]?.kind === 'day')).toBe(true);
  });

  it('counts what the totals count with an event window, and doubles only inside it', async () => {
    const W = 5 * H;
    const solution = await solve({ eventWindowSeconds: W }, DAY);
    consistent(solution);
    const launches = solution.slots!.flatMap(s => s.launches);
    expect(launches.some(l => l.doubled)).toBe(true);
    for (const l of launches) {
      if (l.doubled) expect(l.launchAt).toBeLessThanOrEqual(W);
      expect(l.doubled).toBe(isDoubled(solution.choiceHistory[l.choice]));
    }
    for (const s of planTimeline(solution).slots) expect(s.rows.filter(r => r.kind === 'window-end')).toHaveLength(1);
  });
});
