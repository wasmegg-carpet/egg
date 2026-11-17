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
  solutionView,
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

// One slot's launches as `[choice, launchAt]`.
const slot = (...launches: [number, number][]) => {
  const list: SlotLaunch[] = launches.map(([c, launchAt]) => ({ choice: c, launchAt }));
  const last = list[list.length - 1];
  return { loadSeconds: last ? last.launchAt + H : 0, rawLoadSeconds: 0, launches: list };
};

const launchRows = (rows: TimelineRow[]) => rows.filter((r): r is TimelineLaunchRow => r.kind === 'launch');
const shape = (rows: TimelineRow[]) =>
  rows.map(r => {
    if (r.kind === 'launch')
      return `${r.count}x${r.repeat > 1 ? `*${r.repeat}` : ''}@${r.launchAt}${r.doubled ? ' 2x' : ''}${r.nights ? ' night' : ''}`;
    if (r.kind === 'day')
      return `day ${r.firstDay}-${r.lastDay}${r.routineDay ? ` (${r.routineDay.day}/${r.routineDay.of})` : ''}`;
    if (r.kind === 'routine') return `routine ${r.firstDay}-${r.lastDay} every ${r.period} x${r.times}`;
    return `ends ${r.at}`;
  });

// What the timeline counts of each line of the totals (mission, target, nights, capacity), next to what the
// totals count: the card shows both, and they must agree.
const lineOf = (c: { ship: MissionType; targetAfxId: number; nights?: number }, doubled: boolean) =>
  `${c.ship.shipType}|${c.ship.durationType}|${c.targetAfxId}|${c.nights ?? 0}|${doubled}`;
function counts(solution: OptimizerSolution) {
  const timeline = new Map<string, number>();
  for (const s of planTimeline(solution).slots)
    for (const row of launchRows(s.rows)) {
      const key = lineOf(row.choice, row.doubled);
      timeline.set(key, (timeline.get(key) ?? 0) + row.count * row.repeat);
    }
  const totals = new Map(launchTotals(solution).map(line => [lineOf(line, line.doubled), line.numShipsLaunched]));
  return { timeline, totals };
}
function expectCountsAgree(solution: OptimizerSolution) {
  const { timeline, totals } = counts(solution);
  expect(timeline).toEqual(totals);
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

  it('totals across nights when asked, keeping capacity apart', () => {
    const solution = makeSolution({
      choiceHistory: [
        choice(Ship.CHICKEN_ONE, 1, { nights: 1, variant: 'event' }),
        choice(Ship.CHICKEN_ONE, 4, { nights: 0, variant: 'normal' }),
        choice(Ship.CHICKEN_ONE, 2, { nights: 0, variant: 'overhang' }),
      ],
    });
    expect(launchTotals(solution, { byNights: false })).toEqual([
      expect.objectContaining({ numShipsLaunched: 4, doubled: false }),
      expect.objectContaining({ numShipsLaunched: 3, doubled: true }),
    ]);
    expect(launchTotals(solution, { byNights: false }).every(line => line.nights === undefined)).toBe(true);
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
      slots: [slot([0, 0], [0, H], [0, 2 * H], [1, 3 * H], [1, 4 * H]), slot()],
    });
    const timeline = planTimeline(solution);
    // A launch exactly at the window's end is still inside it.
    expect(shape(timeline.slots[0].rows)).toEqual([`3x@0 2x`, `ends ${2 * H}`, `2x@${3 * H}`]);
    expect(timeline.slots[1].rows).toEqual([]);

    const inside = makeSolution({
      eventWindowSeconds: 10 * H,
      choiceHistory: [choice(Ship.CHICKEN_ONE, 2, { variant: 'event' })],
      slots: [slot([0, 0], [0, H])],
    });
    expect(shape(planTimeline(inside).slots[0].rows)).toEqual(['2x@0 2x', `ends ${10 * H}`]);
  });

  // `event` and `overhang` exist for the solver; the player flies the last doubled launch like any other.
  it("runs a doubled launch's event and overhang variants together, as the totals do", () => {
    const solution = makeSolution({
      eventWindowSeconds: 5 * H,
      choiceHistory: [
        choice(Ship.CHICKEN_ONE, 2, { variant: 'event' }),
        choice(Ship.CHICKEN_ONE, 1, { variant: 'overhang' }),
        choice(Ship.CHICKEN_ONE, 1, { variant: 'normal' }),
      ],
      slots: [slot([0, 0], [0, H], [1, 2 * H], [2, 9 * H])],
    });
    expect(shape(planTimeline(solution).slots[0].rows)).toEqual(['3x@0 2x', `ends ${5 * H}`, `1x@${9 * H}`]);
    expectCountsAgree(solution);
  });

  it('splits a doubled run from a 1x run of the same mission', () => {
    const solution = makeSolution({
      eventWindowSeconds: 5 * H,
      choiceHistory: [
        choice(Ship.CHICKEN_ONE, 2, { variant: 'event' }),
        choice(Ship.CHICKEN_ONE, 1, { variant: 'normal' }),
      ],
      slots: [slot([0, 0], [0, H], [1, 2 * H])],
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
    expectCountsAgree(solution);
  });

  // A ship that takes more than a day to come round gives a plan a rhythm of several days rather than one.
  it('folds a routine of several days, flown over and over, into one showing of it', () => {
    // A three-day routine: two launches, a quiet day, one overnight launch; four times over, then a different day.
    const routine = (d: number): [number, number][] => [
      [0, d * DAY],
      [0, d * DAY + 2 * H],
      [1, (d + 2) * DAY + 15 * H],
    ];
    const solution = makeSolution({
      sleepSeconds: 8 * H,
      choiceHistory: [choice(Ship.CHICKEN_ONE, 9, { nights: 0 }), choice(Ship.CHICKEN_NINE, 4, { nights: 1 })],
      slots: [slot(...routine(0), ...routine(3), ...routine(6), ...routine(9), [0, 12 * DAY])],
    });
    expect(shape(planTimeline(solution).slots[0].rows)).toEqual([
      'routine 0-11 every 3 x4',
      'day 0-0 (1/3)',
      '2x*4@0',
      'day 2-2 (3/3)',
      `1x*4@${2 * DAY + 15 * H} night`,
      'day 12-12',
      `1x@${12 * DAY}`,
    ]);
    expectCountsAgree(solution);
  });

  it('puts a divider that falls overnight between the two days, and folds no day across it', () => {
    const solution = makeSolution({
      sleepSeconds: 8 * H,
      eventWindowSeconds: 20 * H,
      choiceHistory: [
        choice(Ship.CHICKEN_ONE, 2, { nights: 0, variant: 'event' }),
        choice(Ship.CHICKEN_ONE, 2, { nights: 0 }),
      ],
      slots: [slot([0, 0], [0, H], [1, DAY], [1, DAY + H])],
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
    expectCountsAgree(solution);
    const totalLaunches = launchTotals(solution).reduce((n, line) => n + line.numShipsLaunched, 0);
    const slotLaunches = solution.slots!.reduce((n, s) => n + s.launches.length, 0);
    expect(slotLaunches).toBe(totalLaunches);
  };

  it('gives the card one row per target it was solved for', async () => {
    const solution = await solve({}, 2 * DAY);
    const { targets, planCost } = solutionView(solution, null);
    expect(targets.map(t => [t.nodeId, t.name])).toEqual([[lt2, 'Lunar totem']]);
    const [target] = targets;
    expect(target.perTarget).toBe(solution.perTarget[0]);
    expect(target.pCraft).toBe(0.05);
    expect(1 - Math.exp(-target.lambda)).toBeCloseTo(target.perTarget.dropProbability, 12);
    expect(target.missionLegendarySources).toEqual(computeMissionLegendaryRows(solution, lt2));
    expect(planCost.total).toBeGreaterThanOrEqual(0);
  });

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
    const doubled = launches.filter(l => isDoubled(solution.choiceHistory[l.choice]));
    expect(doubled.length).toBeGreaterThan(0);
    for (const l of doubled) expect(l.launchAt).toBeLessThanOrEqual(W);
    for (const s of planTimeline(solution).slots) expect(s.rows.filter(r => r.kind === 'window-end')).toHaveLength(1);
  });
});
