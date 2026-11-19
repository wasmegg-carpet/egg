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
  rows.map(r =>
    r.kind === 'launch'
      ? `${r.count}x@${r.launchAt}${r.doubled ? ' 2x' : ''}${r.overnight ? ' night' : ''}`
      : `ends ${r.at}`
  );

// What the timeline counts of each line of the totals (mission, target, overnight, capacity), next to what the
// totals count: the card shows both, and they must agree.
const lineOf = (c: { ship: MissionType; targetAfxId: number }, overnight: boolean | undefined, doubled: boolean) =>
  `${c.ship.shipType}|${c.ship.durationType}|${c.targetAfxId}|${overnight ?? false}|${doubled}`;
function counts(solution: OptimizerSolution) {
  const timeline = new Map<string, number>();
  for (const s of planTimeline(solution).slots)
    for (const row of launchRows(s.rows)) {
      const key = lineOf(row.choice, row.overnight, row.doubled);
      timeline.set(key, (timeline.get(key) ?? 0) + row.count);
    }
  const totals = new Map(
    launchTotals(solution).map(line => [lineOf(line, line.overnight, line.doubled), line.numShipsLaunched])
  );
  return { timeline, totals };
}
function expectCountsAgree(solution: OptimizerSolution) {
  const { timeline, totals } = counts(solution);
  expect(timeline).toEqual(totals);
}

describe('launchTotals', () => {
  it("folds a mission's event and overhang variants into one 2x line, ahead of its 1x line", () => {
    const solution = makeSolution({
      choiceHistory: [
        choice(Ship.CHICKEN_ONE, 3, { variant: 'normal' }),
        choice(Ship.CHICKEN_ONE, 2, { variant: 'event' }),
        choice(Ship.CHICKEN_ONE, 1, { variant: 'overhang' }),
      ],
    });
    expect(launchTotals(solution).map(l => [l.numShipsLaunched, l.doubled])).toEqual([
      [3, true],
      [3, false],
    ]);
  });

  it('keeps daytime and overnight launches of one mission apart, daytime first', () => {
    const solution = makeSolution({
      choiceHistory: [choice(Ship.CHICKEN_ONE, 1, { nights: 1 }), choice(Ship.CHICKEN_ONE, 4, { nights: 0 })],
    });
    expect(launchTotals(solution).map(l => [l.numShipsLaunched, l.overnight])).toEqual([
      [4, false],
      [1, true],
    ]);
  });

  it('does not tell a one-night launch from a two-night one: both are one overnight line', () => {
    const solution = makeSolution({
      choiceHistory: [choice(Ship.CHICKEN_ONE, 3, { nights: 1 }), choice(Ship.CHICKEN_ONE, 2, { nights: 2 })],
    });
    expect(launchTotals(solution).map(l => [l.numShipsLaunched, l.overnight])).toEqual([[5, true]]);
  });

  it('sorts doubled before 1x, then by ship, duration and target, awake before overnight', () => {
    const withDuration = (c: LaunchSolution, duration: ei.MissionInfo.DurationType): LaunchSolution => ({
      ...c,
      ship: new MissionType(c.ship.shipType, duration),
    });
    const [first, second] = [Name.LUNAR_TOTEM, Name.TUNGSTEN_ANKH].sort((a, b) => a - b);
    const solution = makeSolution({
      choiceHistory: [
        choice(Ship.HENERPRISE, 1, { nights: 1 }),
        choice(Ship.HENERPRISE, 1, { variant: 'event' }),
        choice(Ship.HENERPRISE, 1),
        withDuration(choice(Ship.CHICKEN_NINE, 1, { target: first }), Duration.EPIC),
        choice(Ship.CHICKEN_NINE, 1, { target: second }),
        choice(Ship.CHICKEN_NINE, 1, { target: first }),
        choice(Ship.CHICKEN_NINE, 1, { variant: 'event', target: second }),
      ],
    });
    const order = (s: OptimizerSolution) =>
      launchTotals(s).map(l => [
        l.overnight ? 'night' : 'awake',
        l.doubled ? '2x' : '1x',
        Ship[l.ship.shipType],
        Duration[l.ship.durationType],
        l.targetAfxId,
      ]);
    expect(order(solution)).toEqual([
      ['awake', '2x', 'CHICKEN_NINE', 'SHORT', second],
      ['awake', '2x', 'HENERPRISE', 'SHORT', Name.UNKNOWN],
      ['awake', '1x', 'CHICKEN_NINE', 'SHORT', first],
      ['awake', '1x', 'CHICKEN_NINE', 'SHORT', second],
      ['awake', '1x', 'CHICKEN_NINE', 'EPIC', first],
      ['awake', '1x', 'HENERPRISE', 'SHORT', Name.UNKNOWN],
      ['night', '1x', 'HENERPRISE', 'SHORT', Name.UNKNOWN],
    ]);
    // A function of the plan, not of the order the solver emitted its choices in.
    expect(order({ ...solution, choiceHistory: [...solution.choiceHistory].reverse() })).toEqual(order(solution));
  });

  it('totals across overnight when asked, keeping capacity apart', () => {
    const solution = makeSolution({
      choiceHistory: [
        choice(Ship.CHICKEN_ONE, 1, { nights: 1, variant: 'event' }),
        choice(Ship.CHICKEN_ONE, 4, { nights: 0, variant: 'normal' }),
        choice(Ship.CHICKEN_ONE, 2, { nights: 0, variant: 'overhang' }),
      ],
    });
    // Doubled first, as in every list.
    expect(launchTotals(solution, { byOvernight: false })).toEqual([
      expect.objectContaining({ numShipsLaunched: 3, doubled: true }),
      expect.objectContaining({ numShipsLaunched: 4, doubled: false }),
    ]);
    expect(launchTotals(solution, { byOvernight: false }).every(line => line.overnight === undefined)).toBe(true);
  });

  it('reads a plan made without either window as 1x and daytime', () => {
    const [line] = launchTotals(makeSolution({ choiceHistory: [choice(Ship.CHICKEN_ONE, 2)] }));
    expect(line).toMatchObject({ numShipsLaunched: 2, overnight: false, doubled: false });
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

  it('lists every launch of every day, with no heading and no fold, and the T+ times alone say which day it is', () => {
    const day = (d: number): [number, number][] => [
      [0, d * DAY],
      [0, d * DAY + H],
      [1, d * DAY + 15 * H],
    ];
    const solution = makeSolution({
      sleepSeconds: 8 * H,
      choiceHistory: [choice(Ship.CHICKEN_ONE, 9, { nights: 0 }), choice(Ship.CHICKEN_NINE, 4, { nights: 1 })],
      // Days 0-2 alike, then a different day 3, and day 5 like the first ones.
      slots: [
        slot(...day(0), ...day(1), ...day(2), [0, 3 * DAY], [0, 5 * DAY], [0, 5 * DAY + H], [1, 5 * DAY + 15 * H]),
      ],
    });
    const rows = planTimeline(solution).slots[0].rows;
    expect(rows.every(r => r.kind === 'launch')).toBe(true);
    expect(shape(rows)).toEqual([
      '2x@0',
      `1x@${15 * H} night`,
      `2x@${DAY}`,
      `1x@${DAY + 15 * H} night`,
      `2x@${2 * DAY}`,
      `1x@${2 * DAY + 15 * H} night`,
      `1x@${3 * DAY}`,
      `2x@${5 * DAY}`,
      `1x@${5 * DAY + 15 * H} night`,
    ]);
    expectCountsAgree(solution);
  });

  it('never merges a run across a day boundary on a sleep plan, but does without sleep', () => {
    // The same mission launched at the end of one day and the start of the next, back to back in the slot.
    const launches: [number, number][] = [
      [0, 14 * H],
      [0, 15 * H],
      [0, DAY],
      [0, DAY + H],
    ];
    const asleep = makeSolution({
      sleepSeconds: 8 * H,
      choiceHistory: [choice(Ship.CHICKEN_ONE, 4, { nights: 0 })],
      slots: [slot(...launches)],
    });
    expect(shape(planTimeline(asleep).slots[0].rows)).toEqual([`2x@${14 * H}`, `2x@${DAY}`]);
    expectCountsAgree(asleep);

    const awake = makeSolution({
      choiceHistory: [choice(Ship.CHICKEN_ONE, 4)],
      slots: [slot(...launches)],
    });
    expect(shape(planTimeline(awake).slots[0].rows)).toEqual([`4x@${14 * H}`]);
  });

  it('lists a quiet day or a long routine launch by launch rather than folding it', () => {
    // Two launches, a quiet day and one overnight launch, four times over: nothing folds, every launch is a row.
    const routine = (d: number): [number, number][] => [
      [0, d * DAY],
      [0, d * DAY + 2 * H],
      [1, (d + 2) * DAY + 15 * H],
    ];
    const solution = makeSolution({
      sleepSeconds: 8 * H,
      choiceHistory: [choice(Ship.CHICKEN_ONE, 8, { nights: 0 }), choice(Ship.CHICKEN_NINE, 4, { nights: 1 })],
      slots: [slot(...routine(0), ...routine(3), ...routine(6), ...routine(9))],
    });
    const rows = launchRows(planTimeline(solution).slots[0].rows);
    expect(rows).toHaveLength(8);
    expect(rows.map(r => r.count)).toEqual([2, 1, 2, 1, 2, 1, 2, 1]);
    expect(rows.map(r => r.launchAt)).toEqual(
      [0, 2, 3, 5, 6, 8, 9, 11].map((d, i) => (i % 2 === 0 ? d * DAY : d * DAY + 15 * H))
    );
    expectCountsAgree(solution);
  });

  it('marks a launch overnight by the nights the calendar flies it through, not by its variant', () => {
    // Entry 0 was budgeted as an overnight variant but the calendar flies it in the morning, back the same day;
    // entry 1 was budgeted as a daytime launch but goes up before bed and lands in the night.
    const solution = makeSolution({
      sleepSeconds: 8 * H,
      choiceHistory: [choice(Ship.CHICKEN_ONE, 1, { nights: 1 }), choice(Ship.CHICKEN_NINE, 1, { nights: 0 })],
      slots: [
        {
          loadSeconds: DAY,
          rawLoadSeconds: 0,
          launches: [
            { choice: 0, launchAt: 0, nights: 0 },
            { choice: 1, launchAt: 14 * H, nights: 1 },
          ],
        },
      ],
    });
    expect(shape(planTimeline(solution).slots[0].rows)).toEqual(['1x@0', `1x@${14 * H} night`]);
    expect(launchTotals(solution).map(l => [l.ship.shipType, l.overnight])).toEqual([
      [Ship.CHICKEN_ONE, false],
      [Ship.CHICKEN_NINE, true],
    ]);
    expectCountsAgree(solution);
  });

  it('merges consecutive same-ship overnight launches whatever their night counts', () => {
    const solution = makeSolution({
      sleepSeconds: 8 * H,
      choiceHistory: [choice(Ship.CHICKEN_NINE, 3, { nights: 1 })],
      slots: [
        {
          loadSeconds: 4 * DAY,
          rawLoadSeconds: 0,
          launches: [
            { choice: 0, launchAt: 14 * H, nights: 1 },
            { choice: 0, launchAt: 15 * H, nights: 2 },
            { choice: 0, launchAt: 16 * H, nights: 1 },
          ],
        },
      ],
    });
    expect(shape(planTimeline(solution).slots[0].rows)).toEqual([`3x@${14 * H} night`]);
    expectCountsAgree(solution);
  });

  it('puts a divider that falls between two days between them, and merges no run across it', () => {
    const solution = makeSolution({
      sleepSeconds: 8 * H,
      eventWindowSeconds: 20 * H,
      choiceHistory: [
        choice(Ship.CHICKEN_ONE, 2, { nights: 0, variant: 'event' }),
        choice(Ship.CHICKEN_ONE, 2, { nights: 0 }),
      ],
      slots: [slot([0, 0], [0, H], [1, DAY], [1, DAY + H])],
    });
    expect(shape(planTimeline(solution).slots[0].rows)).toEqual(['2x@0 2x', `ends ${20 * H}`, `2x@${DAY}`]);
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

  it('counts what the totals count with a sleep window, and lists every launch', async () => {
    const solution = await solve({ sleepSeconds: 8 * H }, 3 * DAY);
    consistent(solution);
    // Nothing folds: a row is a run of launches within one day, so the rows hold exactly the calendar's launches.
    const timeline = planTimeline(solution);
    timeline.slots.forEach((s, k) => {
      expect(s.rows.every(r => r.kind === 'launch')).toBe(true);
      const times = launchRows(s.rows).flatMap(r => Array(r.count).fill(r.launchAt));
      expect(times.length).toBe(solution.slots![k].launches.length);
      for (const row of launchRows(s.rows))
        expect(solution.slots![k].launches.map(l => l.launchAt)).toContain(row.launchAt);
    });
  });

  // Review repro: 30-hour ships and 8 hours of sleep over ten days, where the ships go up at a different time of
  // day from one day to the next. Every launch is listed at the time the calendar flies it, none stands in for
  // another, and no run spans a day.
  it('lists each launch at the time the calendar flies it, over ten days of long ships', async () => {
    const solution = finalizeSolutions(
      [
        await optimizeFull({
          options: [makeOpt(1, 30 * H, [[lt1, 1]], [], Name.LUNAR_TOTEM)],
          recipeDag: dag(),
          desiredArtifactNodeIds: [lt2],
          fuelCapacity: 1000,
          timeCapacityPerSlot: 10 * DAY,
          sleepSeconds: 8 * H,
          ownedStock: new Map(),
          maximumCost: undefined,
        }),
      ],
      dag()
    )[0];
    consistent(solution);
    const timeline = planTimeline(solution);
    timeline.slots.forEach((s, k) => {
      const launches = solution.slots![k].launches;
      // Each row is a run of consecutive launches from one day: it starts at a launch's time, and the launches that
      // follow it in the calendar, as many as it counts, are all in the same day.
      let at = 0;
      for (const row of launchRows(s.rows)) {
        expect(launches[at].launchAt).toBe(row.launchAt);
        const day = Math.floor(row.launchAt / DAY);
        for (let i = 0; i < row.count; i++) expect(Math.floor(launches[at + i].launchAt / DAY)).toBe(day);
        at += row.count;
      }
      expect(at).toBe(launches.length);
    });
  });

  // Review repro: 10.8-hour daytime ships over ten days with 8 hours of sleep. Re-timing sends some of them up in
  // the afternoon to land in the night, so the variant's night count (0) is not what the player flies.
  it('shows each launch overnight exactly when it is in the air at bedtime, and frees a slot only awake', async () => {
    const flight = 10.8 * H;
    const sleep = 8 * H;
    const solution = finalizeSolutions(
      [
        await optimizeFull({
          options: [makeOpt(1, flight, [[lt1, 1]], [], Name.LUNAR_TOTEM)],
          recipeDag: dag(),
          desiredArtifactNodeIds: [lt2],
          fuelCapacity: 1000,
          timeCapacityPerSlot: 10 * DAY,
          sleepSeconds: sleep,
          ownedStock: new Map(),
          maximumCost: undefined,
        }),
      ],
      dag()
    )[0];
    consistent(solution);
    const bedtime = DAY - sleep;
    const inAirAtBedtime = (at: number) => {
      const d = Math.floor(at / DAY);
      return at <= d * DAY + bedtime && d * DAY + bedtime < at + flight;
    };
    let overnight = 0;
    for (const s of solution.slots!) {
      for (const l of s.launches) {
        expect(l.nights).toBe(inAirAtBedtime(l.launchAt) ? 1 : 0);
        overnight += l.nights!;
      }
      expect(s.loadSeconds % DAY).toBeLessThanOrEqual(bedtime);
    }
    expect(overnight).toBeGreaterThan(0);
    const totals = launchTotals(solution);
    expect(totals.filter(l => l.overnight).reduce((n, l) => n + l.numShipsLaunched, 0)).toBe(overnight);
    for (const s of planTimeline(solution).slots)
      for (const row of launchRows(s.rows)) expect(row.overnight).toBe(inAirAtBedtime(row.launchAt));
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
