// Harness and judge behaviour around the 2x capacity window: the plan cache's key, and C1 checking the
// order it was given.

import { describe, expect, it } from 'vitest';
import { ei, newShipsConfig, shipMaxLevel, spaceshipList, type ShipsConfig } from 'lib';
import type { Planner, PlanProblem, ScheduleRun } from './contract';
import { run } from './harness';
import type { ArenaInstance } from './instances';
import { checkC1Feasibility, runChecks } from './invariants';

const HOUR = 3600;

// Henerprise alone, no FTL research: Short 24h, Standard 48h, Extended 96h. Every mission is longer than
// the short windows below, which is what makes two different windows produce the identical menu.
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

function instance(eventWindowSeconds: number): ArenaInstance {
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
    eventWindowSeconds,
  };
}

const emptyPlan = (problem: PlanProblem) => ({
  schedule: Array.from({ length: problem.slots }, () => [] as ScheduleRun[]),
});

describe('the plan cache keys on the window', () => {
  it('re-solves when only the window moved', () => {
    // 1h and 2h against a menu whose shortest mission is 24h: no `event` variant is emitted at either, so
    // the two option arrays are identical entry for entry and the window is the only thing that differs.
    let calls = 0;
    const planner: Planner = problem => {
      calls++;
      return emptyPlan(problem);
    };

    const short = instance(HOUR);
    const longer = instance(2 * HOUR);

    const a = run(planner, short);
    expect(calls).toBe(1);

    run(planner, short);
    expect(calls).toBe(1); // same problem, served from cache — that part still works

    const b = run(planner, longer);
    expect(calls).toBe(2);

    // The premise of the test: nothing but the window distinguishes these two problems.
    expect(b.problem.options.map(o => `${o.variant}|${o.id}`)).toEqual(
      a.problem.options.map(o => `${o.variant}|${o.id}`)
    );
    expect(a.problem.eventWindowSeconds).not.toBe(b.problem.eventWindowSeconds);
  });
});

describe('C1 checks the order it was given', () => {
  const window = 48 * HOUR;

  // A slot holding one 96h Extended mission and one doubled launch. Ordered doubled-first it is legal;
  // ordered doubled-last the doubled launch starts at 96h, past a 48h window.
  function pair(problem: PlanProblem) {
    const extended = problem.options.findIndex(o => o.variant === 'normal' && o.actualTime === 96 * HOUR);
    const overhang = problem.options.findIndex(o => o.variant === 'overhang' && o.actualTime === 96 * HOUR);
    expect(extended).toBeGreaterThanOrEqual(0);
    expect(overhang).toBeGreaterThanOrEqual(0);
    return { extended, overhang };
  }

  function c1Violations(schedule: (problem: PlanProblem) => ScheduleRun[][]) {
    const planner: Planner = problem => ({ schedule: schedule(problem) });
    return runChecks(planner, instance(window), [checkC1Feasibility]);
  }

  it('passes the same runs in the order that works', () => {
    const out = c1Violations(problem => {
      const { extended, overhang } = pair(problem);
      return [
        [
          { option: overhang, count: 1 },
          { option: extended, count: 1 },
        ],
        [],
        [],
      ];
    });
    expect(out).toEqual([]);
  });

  it('fails a permutation of those runs that the window rejects', () => {
    // The same multiset as the passing case above, in an order that fails: reordering before checking
    // would make this pass.
    const out = c1Violations(problem => {
      const { extended, overhang } = pair(problem);
      return [
        [
          { option: extended, count: 1 },
          { option: overhang, count: 1 },
        ],
        [],
        [],
      ];
    });
    expect(out).toHaveLength(1);
    expect(out[0].invariant).toBe('C1-feasibility');
    expect(out[0].detail).toMatch(/doubled .* past a .* 2x window/);
  });

  it('fails a run whose tail launches after the window even though its head does not', () => {
    // A run of 8 doubled 24h missions starts at 0, so its first launch is inside a 48h window; the eighth
    // starts at 168h.
    const out = c1Violations(problem => {
      const short = problem.options.findIndex(o => o.variant === 'overhang' && o.actualTime === 24 * HOUR);
      expect(short).toBeGreaterThanOrEqual(0);
      return [[{ option: short, count: 8 }], [], []];
    });
    expect(out.some(v => v.invariant === 'C1-feasibility' && /past a .* 2x window/.test(v.detail))).toBe(true);
  });

  it('fails a slot holding two boundary launches', () => {
    const out = c1Violations(problem => {
      const a = problem.options.findIndex(o => o.variant === 'overhang' && o.actualTime === 24 * HOUR);
      const b = problem.options.findIndex(
        o => o.variant === 'overhang' && o.actualTime === 24 * HOUR && o !== problem.options[a]
      );
      expect(b).toBeGreaterThan(a);
      return [
        [
          { option: a, count: 1 },
          { option: b, count: 1 },
        ],
        [],
        [],
      ];
    });
    expect(out.some(v => /boundary launches/.test(v.detail))).toBe(true);
  });
});
