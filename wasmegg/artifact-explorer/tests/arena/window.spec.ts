// Harness and judge behaviour around the 2x capacity window: the instances, the plan cache's key, the skips, the
// window budgets in the packer, and C1 checking the calendar it was given. See ARENA.md, "The 2x capacity window".

import { afterEach, describe, expect, it } from 'vitest';
import { ei, newShipsConfig, shipMaxLevel, spaceshipList, type ShipsConfig } from 'lib';
import { unsupported, type Planner, type PlanProblem, type PlanResult } from './contract';
import { feasible, run } from './harness';
import { capacityVariants } from './capacity';
import { EVENT_REGIME_NAMES, generateInstance, type ArenaInstance } from './instances';
import { checkA11Window, checkC1Feasibility, runChecks } from './invariants';
import { packFeasibleBudgets } from './pack-feasibility';

const HOUR = 3600;

// Henerprise alone, no FTL research: Short 24h, Standard 48h, Extended 96h. Every mission is longer than the
// short windows below, which is what makes two different windows produce the identical menu.
function henerpriseOnly(): ShipsConfig {
  const config = newShipsConfig();
  config.epicResearchFTLLevel = 0;
  config.epicResearchZerogLevel = 0;
  config.showNodata = true;
  for (const ship of spaceshipList) config.shipVisibility[ship] = false;
  const hen = ei.MissionInfo.Spaceship.HENERPRISE;
  config.shipVisibility[hen] = true;
  config.shipLevels[hen] = shipMaxLevel(hen);
  return config;
}

function instance(eventWindowSeconds: number, sleepSeconds = 0): ArenaInstance {
  return {
    label: `window:${eventWindowSeconds}`,
    seed: 1,
    targets: ['tachyon-deflector-4'],
    config: henerpriseOnly(),
    craftingLevel: 30,
    previousCrafts: 0,
    fuelCapacity: 1e18,
    timeCapacityPerSlot: 30 * 86400,
    effort: 'low',
    sleepSeconds,
    eventWindowSeconds,
  };
}

type Launch = { option: number; at: number };

// A plan stated as its calendar, its allocation summed out of it.
function planOf(problem: PlanProblem, slots: Launch[][]): PlanResult {
  const allocation = new Array<number>(problem.options.length).fill(0);
  for (const slot of slots) for (const l of slot) allocation[l.option]++;
  return {
    allocation,
    calendar: slots.map(slot =>
      slot.map(l => ({
        option: l.option,
        optionId: problem.options[l.option].id,
        launchAt: l.at,
        wakingSeconds: problem.options[l.option].actualTime,
        nights: 0,
        // Written wrong on purpose: the harness reads doubling off its own menu, never off the candidate.
        doubled: false,
      }))
    ),
  };
}

const find = (problem: PlanProblem, variant: string, hours: number, skip = 0) => {
  const found = problem.options
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => (o.variant ?? 'normal') === variant && o.actualTime === hours * HOUR);
  expect(found.length).toBeGreaterThan(skip);
  return found[skip].i;
};

function c1(window: number, slots: (problem: PlanProblem) => Launch[][] | null) {
  const planner: Planner = problem => {
    const plan = slots(problem);
    return plan ? planOf(problem, plan) : { allocation: new Array<number>(problem.options.length).fill(0) };
  };
  return runChecks(planner, instance(window), [checkC1Feasibility], { windowAware: true }).violations;
}

describe('instances', () => {
  afterEach(() => {
    delete process.env.ARENA_WINDOW;
    delete process.env.ARENA_WAKE;
  });

  it('start at wake-up unless ARENA_WAKE asks, and take the offset without moving any other field', () => {
    const plain = [2000, 2001].map(generateInstance);
    expect(plain.every(i => !('wakeOffsetSeconds' in i))).toBe(true);
    process.env.ARENA_WAKE = '12';
    const awake = [2000, 2001].map(generateInstance);
    awake.forEach((inst, i) => {
      expect(inst.wakeOffsetSeconds).toBe(12 * HOUR);
      expect({ ...inst, wakeOffsetSeconds: undefined }).toEqual(plain[i]);
    });
    process.env.ARENA_WAKE = '0';
    expect('wakeOffsetSeconds' in generateInstance(2000)).toBe(false);
    process.env.ARENA_WAKE = '24';
    expect(() => generateInstance(2000)).toThrow(/ARENA_WAKE/);
  });

  it('carry no window unless ARENA_WINDOW asks, and draw it without moving any other field', () => {
    const plain = [2000, 2001, 2017].map(generateInstance);
    expect(plain.every(i => i.eventWindowSeconds === 0)).toBe(true);
    process.env.ARENA_WINDOW = 'draw';
    const drawn = [2000, 2001, 2017].map(generateInstance);
    drawn.forEach((inst, i) => expect({ ...inst, eventWindowSeconds: 0 }).toEqual(plain[i]));
    process.env.ARENA_WINDOW = 'inside';
    expect(generateInstance(2000).eventWindowSeconds).toBe(48 * HOUR);
    process.env.ARENA_WINDOW = 'none';
    expect(generateInstance(2000).eventWindowSeconds).toBe(0);
    process.env.ARENA_WINDOW = 'bogus';
    expect(() => generateInstance(2000)).toThrow(/ARENA_WINDOW/);
    expect(EVENT_REGIME_NAMES).toContain('straddle-over');
  });
});

describe('what a candidate is handed', () => {
  it('skips a window for a candidate that does not declare it, and sleep with a window unless declared', () => {
    const both = { sleepSeconds: 8 * HOUR, eventWindowSeconds: HOUR };
    expect(unsupported({}, { sleepSeconds: 0, eventWindowSeconds: 0 })).toBeUndefined();
    expect(unsupported({}, { sleepSeconds: 0, eventWindowSeconds: HOUR })).toMatch(/window-aware/);
    expect(unsupported({ windowAware: true }, { sleepSeconds: 0, eventWindowSeconds: HOUR })).toBeUndefined();
    expect(unsupported({ sleepAware: true, windowAware: true }, both)).toMatch(/one at a time/);
    expect(unsupported({ sleepAware: true, windowAware: true, windowWithSleepAware: true }, both)).toBeUndefined();
  });

  it('A11-window is skipped for a candidate that is not window-aware', () => {
    const planner: Planner = problem => ({ allocation: new Array<number>(problem.options.length).fill(0) });
    expect(runChecks(planner, instance(0), [checkA11Window], {}).skipped).toEqual(['A11-window']);
  });

  it('the menu is the arena’s own capacity rule over the enumerated one', () => {
    const planner: Planner = problem => ({ allocation: new Array<number>(problem.options.length).fill(0) });
    const plain = run(planner, instance(0));
    const evented = run(planner, instance(48 * HOUR));
    expect(plain.problem.eventWindowSeconds).toBeUndefined();
    expect(plain.problem.options.every(o => o.variant === undefined)).toBe(true);
    expect(evented.problem.eventWindowSeconds).toBe(48 * HOUR);
    expect(evented.problem.options.map(o => o.id)).toEqual(
      capacityVariants(plain.problem.options, 48 * HOUR).map(o => o.id)
    );
  });
});

describe('the plan cache keys on the window', () => {
  it('re-solves when only the window moved', () => {
    // 1h and 2h against a menu whose shortest mission is 24h: no `event` variant at either, so the two menus are
    // identical entry for entry and the window is the only thing that differs.
    let calls = 0;
    const planner: Planner = problem => {
      calls++;
      return planOf(problem, [[], [], []]);
    };
    const a = run(planner, instance(HOUR));
    run(planner, instance(HOUR));
    expect(calls).toBe(1);
    const b = run(planner, instance(2 * HOUR));
    expect(calls).toBe(2);
    expect(b.problem.options.map(o => o.id)).toEqual(a.problem.options.map(o => o.id));
  });
});

describe('C1 checks the calendar it was given', () => {
  const window = 48 * HOUR;

  it('passes a doubled launch that goes up first', () => {
    const out = c1(window, p => [
      [
        { option: find(p, 'overhang', 96), at: 0 },
        { option: find(p, 'normal', 96), at: 96 * HOUR },
      ],
      [],
      [],
    ]);
    expect(out).toEqual([]);
  });

  it('fails the same launches with the doubled one after the window', () => {
    const out = c1(window, p => [
      [
        { option: find(p, 'normal', 96), at: 0 },
        { option: find(p, 'overhang', 96), at: 96 * HOUR },
      ],
      [],
      [],
    ]);
    // Broken both ways: the 1x launch goes up inside the window, where the game doubles it, and the doubled one
    // after it.
    expect(out.map(v => v.invariant)).toEqual(['C1-feasibility', 'C1-feasibility']);
    expect(out[0].detail).toMatch(/flies 1x inside the 2x window/);
    expect(out[1].detail).toMatch(/flies doubled, past the 2x window/);
  });

  it('reads the window rule off the launch time, not the labels', () => {
    // Two `overhang` launches in one slot, both going up inside the window: every launch here is doubled in the
    // game, so the plan is legal although the solver's own rows would have labelled the first one `event`.
    const out = c1(window, p => [
      [
        { option: find(p, 'overhang', 24), at: 0 },
        { option: find(p, 'overhang', 24), at: 24 * HOUR },
      ],
      [],
      [],
    ]);
    expect(out).toEqual([]);
  });

  it('fails the tail of a run of doubled launches that outlasts the window', () => {
    const out = c1(window, p => [
      Array.from({ length: 8 }, (_, i) => ({ option: find(p, 'event', 24), at: i * 24 * HOUR })),
      [],
      [],
    ]);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every(v => v.invariant === 'C1-feasibility' && /past the 2x window/.test(v.detail))).toBe(true);
  });

  it('fails a plan for a window problem that comes without a calendar', () => {
    const out = c1(window, () => null);
    expect(out.map(v => v.detail)).toEqual(['no calendar returned for a problem with a 2x window']);
  });

  it('verifies a calendar on a problem without a window too', () => {
    const out = c1(0, p => [
      [{ option: find(p, 'normal', 96), at: 0 }],
      [],
      [{ option: find(p, 'normal', 96), at: -1 }],
    ]);
    expect(out.map(v => v.detail)).toEqual([expect.stringMatching(/before the slot is free/)]);
  });
});

describe('the packer holds the window budgets as the labels state them', () => {
  // [seconds, event seconds, overhangs] per launch class; slots of 100s, a 30s window.
  const pack = (costs: number[][], counts: number[], slots = 3) =>
    packFeasibleBudgets(costs, counts, [100, 30, 1], slots);

  it('bounds each slot by the window, not only by the horizon', () => {
    expect(pack([[10, 10, 0]], [9])).toBe('packs');
    expect(pack([[10, 10, 0]], [10])).toBe('infeasible');
  });

  it('allows one overhang per slot and no more, a zero-second one included', () => {
    expect(pack([[50, 0, 1]], [3])).toBe('packs');
    expect(pack([[50, 0, 1]], [4])).toBe('infeasible');
    expect(pack([[0, 0, 1]], [4])).toBe('infeasible');
  });

  it('finds the one arrangement satisfying every budget at once', () => {
    // Two slots. On seconds alone both event launches could share a slot; on the window alone they cannot.
    expect(
      pack(
        [
          [80, 0, 0],
          [20, 20, 0],
        ],
        [2, 2],
        2
      )
    ).toBe('packs');
    expect(
      pack(
        [
          [80, 0, 0],
          [20, 20, 0],
        ],
        [2, 3],
        2
      )
    ).toBe('infeasible');
  });

  it('feasible() reads the labels: two overhangs in each of three slots is refused, though C1 would pass them', () => {
    const planner: Planner = problem => ({ allocation: new Array<number>(problem.options.length).fill(0) });
    const { problem } = run(planner, instance(48 * HOUR));
    const allocation = new Array<number>(problem.options.length).fill(0);
    allocation[find(problem, 'overhang', 24)] = 3;
    expect(feasible(problem, allocation)).toBe(true);
    allocation[find(problem, 'overhang', 24)] = 6;
    expect(feasible(problem, allocation)).toBe(false);
  });
});
