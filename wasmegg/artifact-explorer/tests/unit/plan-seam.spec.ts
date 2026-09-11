// The artifact-explorer half of the ascension-planner seam, exercised against the two fixtures in
// `tests/fixtures/`. `wasmegg/ascension-planner/src/lib/humilityPlan.spec.ts` reads the same files
// from the other side; see the README beside them for why there is only one copy.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { ei } from 'lib';
import { fuelTankSizes, MissionType } from 'lib/missions';

import { gemBudgetFor, parsePlanSave, PlanSaveError, sliceHumilityVisits } from '@/lib/plan/read';
import { buildHumilityPlanFile, projectSolvedVisit } from '@/lib/plan/write';
import { HUMILITY_PLAN_SCHEMA, type HumilityPlanFile } from '@/lib/plan/schema';
import type { LaunchSolution, OptimizerSolution, SlotSummary } from '@/lib/types';

const FIXTURES = new URL('../fixtures/', import.meta.url).pathname;

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(FIXTURES + name, 'utf8'));
}

const planSave = () => parsePlanSave(fixture('ascension-plan.json'));
const humilityPlan = fixture('humility-plan.json') as HumilityPlanFile;

// 2026-03-01T12:00:00Z, the fixture's ascension start.
const ASCENSION_START = Date.UTC(2026, 2, 1, 12, 0, 0) / 1000;

describe('reading a plan save', () => {
  it('rejects a file that is not a plan, and one from a version it cannot read', () => {
    expect(() => parsePlanSave({ actions: [], initialState: {} })).toThrow(/no `version`/);
    expect(() => parsePlanSave({ ...(fixture('ascension-plan.json') as object), version: 2 })).toThrow(/version 2/);
  });

  it('never budgets a visit at the one-chicken rate the arriving shift snapshots', () => {
    const bare = fixture('ascension-plan.json') as { actions: { type: string; endState: Record<string, unknown> }[] };
    // What a real export looks like: `shift` sets population to 1, so the arrival snapshot carries
    // a rate orders of magnitude under the farm's, and the fixture's flat rates hide that.
    const troughed = {
      ...bare,
      actions: bare.actions.map(a =>
        a.endState.currentEgg === 'humility' && a.type === 'shift'
          ? { ...a, endState: { ...a.endState, onlineEarnings: 6e19, offlineEarnings: 4e19 } }
          : a
      ),
    };
    const [first, second] = sliceHumilityVisits(parsePlanSave(troughed));

    // Visit 1's run continues past the shift, so a later action in it witnesses the real rate.
    expect(first.earningsPerSecond).toBe(5e33);
    // Visit 2's run is the shift alone — the plan has scheduled nothing on Humility yet, the case
    // this page exists for — so the rate comes off the action before arrival instead.
    expect(second.plannedDurationSeconds).toBe(0);
    expect(second.earningsPerSecond).toBe(7e33);
  });

  it('reads the plan through the envelope the planner’s library exports it in', () => {
    const bare = fixture('ascension-plan.json') as object;
    const wrapped = { version: 1, type: 'plan', name: 'my-cycle', timestamp: 0, data: bare };

    expect(parsePlanSave(wrapped)).toEqual(bare);
    // The envelope's own `version` numbers the export format, not the save; only the inner one is
    // checked, so an unreadable save inside a readable envelope is still rejected.
    expect(() => parsePlanSave({ ...wrapped, data: { ...bare, version: 2 } })).toThrow(/version 2/);
    expect(() => parsePlanSave({ version: 1, type: 'plan' })).toThrow(PlanSaveError);
  });

  it('sends a whole-library export back rather than guessing which plan was meant', () => {
    const library = { version: 1, type: 'library', plans: [{ name: 'a', data: fixture('ascension-plan.json') }] };
    expect(() => parsePlanSave(library)).toThrow(/library/i);
  });

  it('slices one visit per run on Humility, keyed on the action that entered it', () => {
    const visits = sliceHumilityVisits(planSave());
    expect(visits.map(v => v.visitId)).toEqual(['shift_a1b2c3d', 'shift_e5e5e5e']);
    expect(visits.map(v => v.visitIndex)).toEqual([0, 1]);
  });

  it('reads each visit’s budgets off the boundary action, not off the plan’s end', () => {
    const [first, second] = sliceHumilityVisits(planSave());

    // The tank grows between the two visits, which is the whole reason the read is per visit:
    // `store_fuel` and `remove_fuel` exist, so a single plan-wide figure would be wrong at one of
    // them. (Epic research has no action, so that one *is* read plan-wide.)
    expect(first.fuelByEgg.get(ei.Egg.CURIOSITY)).toBe(4.5e14);
    expect(second.fuelByEgg.get(ei.Egg.CURIOSITY)).toBe(8e14);
    expect(first.tankLevel).toBe(6);
    expect(second.tankLevel).toBe(7);
    expect(first.epicResearchFTLLevel).toBe(55);
    expect(second.epicResearchFTLLevel).toBe(55);
  });

  it('never budgets Humility, which the optimizer strips from every mission', () => {
    for (const visit of sliceHumilityVisits(planSave())) {
      expect(visit.fuelByEgg.has(ei.Egg.HUMILITY)).toBe(false);
      expect([...visit.fuelByEgg.keys()].sort()).toEqual(
        [ei.Egg.CURIOSITY, ei.Egg.INTEGRITY, ei.Egg.RESILIENCE, ei.Egg.KINDNESS].sort()
      );
    }
  });

  it('counts the time the plan already spends on Humility, and the shift that arrives there', () => {
    const [first, second] = sliceHumilityVisits(planSave());

    // Arrival is after the shift completes: 0 (start) + 3600 (the shift itself).
    expect(first.arrivalTimestamp).toBe(ASCENSION_START + 3600);
    // Everything before the second shift, plus that shift.
    expect(second.arrivalTimestamp).toBe(ASCENSION_START + 3600 + 86400 + 1800 + 43200 + 1800);

    expect(first.plannedDurationSeconds).toBe(86400);
    // Nothing scheduled there yet. Normal, and exactly the case a player comes to this page for,
    // so it must read as zero rather than as an error.
    expect(second.plannedDurationSeconds).toBe(0);
  });

  it('prices a ship at the bank on arrival plus what the visit earns', () => {
    const [first] = sliceHumilityVisits(planSave());
    // Online earnings beat offline in the fixture, matching what the planner's own launch screen
    // budgets against.
    expect(gemBudgetFor(first, 86400)).toBeCloseTo(1.9e39 + 5e33 * 86400, -30);
    // A visit with no time still has its bank.
    expect(gemBudgetFor(first, 0)).toBe(1.9e39);
  });

  it('stays planable when the save carries no readable ascension clock', () => {
    const undated = { ...(fixture('ascension-plan.json') as { virtueState: unknown }) };
    delete (undated as { virtueState?: unknown }).virtueState;
    const visits = sliceHumilityVisits(parsePlanSave(undated));
    expect(visits).toHaveLength(2);
    expect(visits[0].arrivalTimestamp).toBeNull();
    expect(visits[0].fuelByEgg.get(ei.Egg.CURIOSITY)).toBe(4.5e14);
  });
});

// Every branch below is a validator or a coercion, and neither is visible while the input is
// well-formed: `parsePlanSave` is fed a file the user picked off their own disk, and the format is
// hand-editable JSON. What the guards buy is the difference between a message the player can act
// on and a budget of NaN carried silently into the optimizer, so the negative cases are where they
// are worth anything at all. Malformed inputs are built from the good fixture so that each one
// differs from a working plan in exactly the field under test.
describe('reading a malformed plan save', () => {
  interface RawPlan {
    version: number;
    virtueState: Record<string, unknown>;
    initialState: Record<string, unknown>;
    actions: {
      id: string;
      type: string;
      totalTimeSeconds: number;
      endState: Record<string, unknown>;
    }[];
  }
  const raw = () => fixture('ascension-plan.json') as RawPlan;

  it('rejects anything that is not a JSON object before reaching into it', () => {
    for (const notAPlan of [null, undefined, 42, 'looks like a plan to me']) {
      expect(() => parsePlanSave(notAPlan)).toThrow(PlanSaveError);
    }
    // Specifically a PlanSaveError and not the TypeError that peeling the envelope off a null
    // would raise: the file picker shows this message to the player.
    expect(() => parsePlanSave(null)).toThrow(/expected a JSON object/);
  });

  it('says which field is missing rather than reporting a version it never read', () => {
    // Without the type check the `version !== SUPPORTED` comparison below still rejects both of
    // these, but as "this plan file is version undefined", which sends the player looking for a
    // matching planner build that does not exist.
    expect(() => parsePlanSave({ ...raw(), version: undefined })).toThrow(/no `version`/);
    expect(() => parsePlanSave({ ...raw(), version: '1' })).toThrow(/no `version`/);
  });

  it('rejects a save whose `actions` or `initialState` is the wrong shape', () => {
    expect(() => parsePlanSave({ ...raw(), actions: undefined })).toThrow(/`actions`/);
    expect(() => parsePlanSave({ ...raw(), actions: {} })).toThrow(/`actions`/);
    expect(() => parsePlanSave({ ...raw(), initialState: null })).toThrow(/`initialState`/);
    expect(() => parsePlanSave({ ...raw(), initialState: 'EIxxxxxxxxxx' })).toThrow(/`initialState`/);
  });

  it('turns every unusable number in a snapshot into zero instead of carrying NaN forward', () => {
    const plan = raw();
    const damaged = {
      ...plan,
      actions: plan.actions.map(action =>
        action.id === 'shift_a1b2c3d'
          ? {
              ...action,
              totalTimeSeconds: -3600,
              endState: {
                ...action.endState,
                tankLevel: undefined,
                bankValue: null,
                onlineEarnings: 'a lot',
                offlineEarnings: Number.NaN,
                // A negative amount, a non-numeric one, and an egg key that is simply absent. The
                // readable one is half a unit rather than a full tank: the guard is `> 0`, and every
                // plausible tank figure is also `> 1`, so a full tank cannot tell those two apart.
                fuelTankAmounts: { curiosity: -1, integrity: 'none', resilience: 0.5 },
              },
            }
          : action
      ),
    };
    const [first] = sliceHumilityVisits(parsePlanSave(damaged));

    expect(first.tankLevel).toBe(0);
    expect(first.bankValue).toBe(0);
    expect(first.fuelByEgg.get(ei.Egg.CURIOSITY)).toBe(0);
    expect(first.fuelByEgg.get(ei.Egg.INTEGRITY)).toBe(0);
    expect(first.fuelByEgg.get(ei.Egg.KINDNESS)).toBe(0);
    expect(first.fuelByEgg.get(ei.Egg.RESILIENCE)).toBe(0.5);
    // Both of the arriving snapshot's rates are unreadable, so the visit is priced off the later
    // action in its own run — the same fallback the one-chicken trough uses, reached differently.
    expect(first.earningsPerSecond).toBe(5e33);
    // A negative duration is not time the plan spends anywhere; it must not run the clock
    // backwards for every action after it either.
    expect(first.arrivalTimestamp).toBe(ASCENSION_START);
  });

  it('needs every part of the ascension clock, not just the date', () => {
    // The three fields are read in one condition, so dropping any one of them has to reach the same
    // undated visit. Losing only the time is the case that separates them: a save that still carries a
    // date gets as far as the formatter, where an undefined time is a TypeError out of a file picker
    // rather than a visit the player can still plan.
    for (const missing of ['ascensionDate', 'ascensionTime', 'ascensionTimezone'] as const) {
      const plan = raw();
      const virtueState = { ...plan.virtueState };
      delete virtueState[missing];
      const [visit] = sliceHumilityVisits(parsePlanSave({ ...plan, virtueState }));
      expect(visit.arrivalTimestamp).toBeNull();
      expect(visit.tankLevel).toBeGreaterThan(0);
    }
  });

  it('counts a sub-second action as time rather than rounding it away', () => {
    // `secondsOf` gates on `> 0`, and the difference between that and `>= 1` is invisible on a
    // fixture whose durations are all hours.
    const plan = raw();
    const brief = {
      ...plan,
      actions: plan.actions.map(action =>
        action.id === 'wait_b1b1b1b' ? { ...action, totalTimeSeconds: 0.25 } : action
      ),
    };
    const [first] = sliceHumilityVisits(parsePlanSave(brief));
    expect(first.plannedDurationSeconds).toBe(0.25);
  });

  it('reads a plan whose very first action is already on Humility', () => {
    // The visit then has no action before it to take a rate from. `earningsRateOf(undefined)` is
    // the only caller that can be handed nothing, and reaching into it throws rather than
    // returning a rate of zero.
    const plan = raw();
    const arrival = plan.actions.find(a => a.id === 'shift_a1b2c3d')!;
    const [first] = sliceHumilityVisits(parsePlanSave({ ...plan, actions: [arrival, ...plan.actions.slice(2)] }));

    expect(first.visitId).toBe('shift_a1b2c3d');
    expect(first.earningsPerSecond).toBe(5e33);
  });

  it('takes the better of the two earnings rates, and zero when neither can be read', () => {
    const plan = raw();
    // Offline beating online is a farm the plan leaves running unattended. The fixture's online
    // rate always wins, so a reader that consulted only `onlineEarnings` matches it exactly.
    const offlineWins = {
      ...plan,
      actions: plan.actions.map(action =>
        action.id === 'wait_b1b1b1b'
          ? { ...action, endState: { ...action.endState, onlineEarnings: 1e30, offlineEarnings: 8e33 } }
          : action
      ),
    };
    expect(sliceHumilityVisits(parsePlanSave(offlineWins))[0].earningsPerSecond).toBe(8e33);

    // Nothing readable in the run and no action before it either, since the plan opens on
    // Humility. The rate is zero — not a stand-in constant, which would price this visit's ships
    // at whatever a second of it happens to be worth.
    const blind = {
      ...plan,
      actions: plan.actions.slice(1).map(action => ({
        ...action,
        endState: { ...action.endState, onlineEarnings: undefined, offlineEarnings: 'lots' },
      })),
    };
    const [first] = sliceHumilityVisits(parsePlanSave(blind));
    expect(first.earningsPerSecond).toBe(0);
    expect(gemBudgetFor(first, 86400)).toBe(first.bankValue);
  });

  it('reads absent epic research as level zero', () => {
    // AP omits the whole map on a save with no epic research bought, and a default of anything
    // else silently lengthens every mission the optimizer prices.
    const plan = raw();
    const [first] = sliceHumilityVisits(parsePlanSave({ ...plan, initialState: {} }));
    expect(first.epicResearchFTLLevel).toBe(0);
    expect(first.epicResearchZerogLevel).toBe(0);
  });

  it('prices a visit at its bank alone when the duration it is given is unusable', () => {
    const [first] = sliceHumilityVisits(planSave());
    expect(gemBudgetFor(first, -86400)).toBe(first.bankValue);
    expect(gemBudgetFor(first, Number.NaN)).toBe(first.bankValue);
    // ...but a fraction of a second is still earning time.
    expect(gemBudgetFor(first, 0.5)).toBe(first.bankValue + first.earningsPerSecond * 0.5);
  });

  it('resolves the ascension clock through its IANA zone rather than as UTC', () => {
    // The one calculation on this side of the seam that has to agree with the planner's own.
    // 2026-03-01 00:30 in New York is 05:30 UTC: a winter date, so the offset is a whole -5 hours
    // and not the -4 that reading it after the March changeover would give. The time of day is
    // neither noon — where a 12-hour clock reads the same as a 24-hour one, which is why the
    // fixture's own 12:00 cannot see this — nor midnight, where they differ by the full 12.
    const plan = raw();
    const zoned = {
      ...plan,
      virtueState: {
        ...plan.virtueState,
        ascensionDate: '2026-03-01',
        ascensionTime: '00:30',
        ascensionTimezone: 'America/New_York',
      },
    };
    const [first] = sliceHumilityVisits(parsePlanSave(zoned));
    expect(first.arrivalTimestamp).toBe(Date.UTC(2026, 2, 1, 5, 30, 0) / 1000 + 3600);
  });

  it('leaves a visit undated when the ascension clock cannot be read', () => {
    const plan = raw();
    const undated = { ...plan, virtueState: { ...plan.virtueState, ascensionDate: 'sometime in March' } };
    const [first] = sliceHumilityVisits(parsePlanSave(undated));
    expect(first.arrivalTimestamp).toBeNull();
    // Undated, not unplanable: everything else the visit needs is still there.
    expect(first.tankLevel).toBe(6);
  });
});

// A hand-built stand-in for what the solver returns. Only the fields the projection reads are
// filled: the point is the projection, and building one through the MILP would make this spec a
// solver test that fails for solver reasons.
function launch(
  ship: ei.MissionInfo.Spaceship,
  duration: ei.MissionInfo.DurationType,
  targetAfxId: ei.ArtifactSpec.Name,
  count: number
): LaunchSolution {
  return {
    ship: new MissionType(ship, duration),
    actualFuel: 0,
    actualFuelByEgg: new Map(),
    actualTime: 0,
    target: '',
    targetAfxId,
    numShipsLaunched: count,
    supplyVector: new Map(),
    legendarySupplyVector: new Map(),
  };
}

function solutionOf(runs: LaunchSolution[], overrides: Partial<OptimizerSolution> = {}): OptimizerSolution {
  const slots: SlotSummary[] = [{ loadSeconds: 0, rawLoadSeconds: 0, missionCount: 0 }];
  return {
    bestProbability: 0,
    craftProbability: 0,
    dropProbability: 0,
    expectedCrafts: 0,
    fuelUsed: 0,
    fuelByEgg: new Map(),
    timeUnitsUsed: 950400,
    runningTimeSeconds: 933120,
    slots,
    choiceHistory: runs,
    expectedDrops: [],
    finalYieldVector: new Map(),
    baseYield: new Map(),
    recipeDag: new Map(),
    craftPrimal: new Map(),
    perTarget: [],
    jointProbability: 0,
    ...overrides,
  };
}

describe('writing a humility plan', () => {
  const Spaceship = ei.MissionInfo.Spaceship;
  const DurationType = ei.MissionInfo.DurationType;
  const SHIP_IN_A_BOTTLE = 25 as ei.ArtifactSpec.Name;

  it('reproduces the checked-in file for the first visit', () => {
    const [visit] = sliceHumilityVisits(planSave());
    const expected = humilityPlan.visits[0];

    const solved = projectSolvedVisit({
      visit,
      effort: 'medium',
      gemBudget: expected.gemBudget,
      solution: solutionOf(
        [
          launch(Spaceship.ATREGGIES, DurationType.EPIC, SHIP_IN_A_BOTTLE, 9),
          launch(Spaceship.HENERPRISE, DurationType.LONG, SHIP_IN_A_BOTTLE, 4),
        ],
        {
          fuelByEgg: new Map([
            [ei.Egg.CURIOSITY, 5.3e14],
            [ei.Egg.RESILIENCE, 4e14],
            [ei.Egg.KINDNESS, 7.35e14],
          ]),
          perTarget: [
            {
              nodeId: 'ship-in-a-bottle-4',
              bestProbability: 0.87,
              craftProbability: 0,
              dropProbability: 0,
              expectedCrafts: 3.2,
            },
          ],
          jointProbability: 0.87,
        }
      ),
    });

    // Every field but the gem total is exact. That one is a running sum of ship prices around
    // 1e39, so its last bits depend on the order the launches were added; the fixture carries the
    // figure a human would write and this compares against it relatively.
    const { gemCost, ...solvedRest } = solved;
    const { gemCost: expectedGemCost, ...expectedRest } = expected;
    expect(solvedRest).toEqual(expectedRest);
    expect(Math.abs(gemCost / expectedGemCost - 1)).toBeLessThan(1e-12);
  });

  it('crosses ships and durations as enum names, never as integers', () => {
    // The planner numbers durations SHORT=1/LONG=2/EPIC=3 while the protobuf here numbers them
    // from zero, so its EPIC is our TUTORIAL. Integers over this seam are silently wrong.
    const [visit] = sliceHumilityVisits(planSave());
    const solved = projectSolvedVisit({
      visit,
      effort: 'medium',
      gemBudget: 0,
      solution: solutionOf([launch(Spaceship.ATREGGIES, DurationType.EPIC, SHIP_IN_A_BOTTLE, 1)]),
    });
    expect(solved.launches[0].ship).toBe('ATREGGIES');
    expect(solved.launches[0].duration).toBe('EPIC');
    // Targets go the other way: the numeric enum is the protobuf's, with no second copy to drift.
    expect(solved.launches[0].targetAfxId).toBe(25);
  });

  it('aggregates on (ship, duration, target), collapsing repeats of one option', () => {
    const [visit] = sliceHumilityVisits(planSave());
    const solved = projectSolvedVisit({
      visit,
      effort: 'medium',
      gemBudget: 0,
      solution: solutionOf([
        launch(Spaceship.ATREGGIES, DurationType.EPIC, SHIP_IN_A_BOTTLE, 9),
        launch(Spaceship.ATREGGIES, DurationType.EPIC, SHIP_IN_A_BOTTLE, 3),
      ]),
    });
    expect(solved.launches).toHaveLength(1);
    expect(solved.launches[0].count).toBe(12);
  });

  it('separates the same ship aimed at two targets, which a {ship, duration, count} triple cannot', () => {
    const [visit] = sliceHumilityVisits(planSave());
    const solved = projectSolvedVisit({
      visit,
      effort: 'medium',
      gemBudget: 0,
      solution: solutionOf([
        launch(Spaceship.ATREGGIES, DurationType.EPIC, SHIP_IN_A_BOTTLE, 9),
        launch(Spaceship.ATREGGIES, DurationType.EPIC, 27 as ei.ArtifactSpec.Name, 2),
      ]),
    });
    expect(solved.launches.map(l => [l.targetAfxId, l.count])).toEqual([
      [25, 9],
      [27, 2],
    ]);
  });

  it('writes no Humility key, because the planner adds that one back from its own table', () => {
    const [visit] = sliceHumilityVisits(planSave());
    const solved = projectSolvedVisit({
      visit,
      effort: 'medium',
      gemBudget: 0,
      solution: solutionOf([launch(Spaceship.ATREGGIES, DurationType.EPIC, SHIP_IN_A_BOTTLE, 1)], {
        // A Humility entry can only get here if `phases.ts` stops stripping it. If that ever
        // happens the planner would double-count, so it is dropped rather than passed on.
        fuelByEgg: new Map([
          [ei.Egg.HUMILITY, 7.5e13],
          [ei.Egg.CURIOSITY, 5e13],
        ]),
      }),
    });
    expect(solved.fuelRequired).not.toHaveProperty('humility');
    expect(solved.fuelRequired.curiosity).toBe(5e13);
  });

  it('assembles a file the planner will accept, ordered by visit', () => {
    const file = buildHumilityPlanFile('ascension-plan', [humilityPlan.visits[1], humilityPlan.visits[0]]);
    expect(file.schema).toBe(HUMILITY_PLAN_SCHEMA);
    expect(file.schemaVersion).toBe(humilityPlan.schemaVersion);
    expect(file.visits.map(v => v.visitIndex)).toEqual([0, 1]);
  });

  it('survives JSON.stringify, which the solution it projects does not', () => {
    // `OptimizerSolution` is full of Maps, which stringify as `{}`. The export is a projection for
    // exactly this reason, and this is the assertion that keeps it one.
    const file = buildHumilityPlanFile('ascension-plan', humilityPlan.visits);
    const roundTripped = JSON.parse(JSON.stringify(file)) as HumilityPlanFile;
    expect(roundTripped.visits).toEqual(humilityPlan.visits);
  });
});

// The store modules read localStorage at import time, so they are imported dynamically, after the
// globals a browser would have supplied.
async function planStore() {
  vi.stubGlobal('window', { location: { pathname: '/artifact-explorer/' } });
  vi.stubGlobal('localStorage', {} as Storage);
  const plan = await import('@/store/plan');
  plan.setLoadedPlan('ascension-plan', sliceHumilityVisits(planSave()));
  return plan;
}

async function storeWithVisit(index: number) {
  const plan = await planStore();
  const store = await import('@/store/index');
  plan.setCurrentVisit(plan.loadedPlan.value!.visits[index].visitId);
  return store;
}

// A recorded answer, of the shape the export carries. Only the join key matters here.
function solvedAt(visitId: string) {
  return { ...humilityPlan.visits[0], visitId };
}

describe('pointing the optimizer at a visit', () => {
  it('starts off the plan, so loading a file does not swap the budgets under a selection', async () => {
    const plan = await planStore();
    expect(plan.loadedPlan.value!.currentVisitId).toBeNull();
    expect(plan.activePlanVisit.value).toBeNull();
  });

  it('seeds a visit that has no targets from what is already selected, and only then', async () => {
    const plan = await planStore();
    const [first, second] = plan.loadedPlan.value!.visits;

    plan.setCurrentVisit(first.visitId, ['ship-in-a-bottle-4']);
    expect(plan.settingsFor(first.visitId).targetIds).toEqual(['ship-in-a-bottle-4']);

    // Its own targets are the visit's answer to this question and are never overwritten by
    // whatever the page happened to be showing when it was picked.
    plan.setCurrentVisit(second.visitId, ['tungsten-ankh-4']);
    plan.setCurrentVisit(first.visitId, ['tungsten-ankh-4']);
    expect(plan.settingsFor(first.visitId).targetIds).toEqual(['ship-in-a-bottle-4']);
  });

  it('retracts a visit’s answer on any change to what the answer was to', async () => {
    const plan = await planStore();
    const visit = plan.loadedPlan.value!.visits[0];
    const edits: (() => void)[] = [
      () => plan.setVisitTargets(visit.visitId, ['tungsten-ankh-4']),
      () => plan.setVisitWaitTime(visit.visitId, '3d'),
      () => plan.setVisitFuelBudget(visit.visitId, 'full-tank'),
    ];

    for (const edit of edits) {
      plan.recordSolvedVisit(solvedAt(visit.visitId));
      expect(plan.solvedVisitCount.value).toBe(1);
      edit();
      expect(plan.solvedVisitCount.value).toBe(0);
    }
  });

  it('keeps it when the time budget is re-spelled rather than changed', async () => {
    const plan = await planStore();
    // The plan spends 86400s here, and the field normalizes on blur, so `1d` is written back over
    // it with no edit at all. Nothing would recompute after a retraction here — the seconds the
    // solver reads never moved — so the export would just lose the visit.
    const visit = plan.loadedPlan.value!.visits[0];
    plan.recordSolvedVisit(solvedAt(visit.visitId));

    for (const spelling of ['1d', '24h', '1']) {
      plan.setVisitWaitTime(visit.visitId, spelling);
      expect(plan.waitTimeSecondsFor(visit)).toBe(86400);
      expect(plan.solvedVisitCount.value).toBe(1);
    }

    plan.setVisitWaitTime(visit.visitId, '2d');
    expect(plan.solvedVisitCount.value).toBe(0);
  });
});

describe('the budgets the optimizer worker is handed', () => {
  it('structured-clone once the visit has been through the reactive plan store', async () => {
    const store = await storeWithVisit(0);
    const budget = store.effectiveFuelByEggCapacity.value;

    // `loadedPlan` is a deep ref, so the visit's `fuelByEgg` comes back out of it as a reactive
    // proxy, and a proxied Map has no [[MapData]] for structured clone to read — `postMessage`
    // would throw `DataCloneError` for every solve on a plan visit.
    expect(() => structuredClone({ fuelByEggCapacity: budget })).not.toThrow();
    expect(budget!.get(ei.Egg.CURIOSITY)).toBe(4.5e14);
  });

  it('drop the per-egg rows for a visit set to plan a full tank', async () => {
    const store = await storeWithVisit(0);
    const plan = await import('@/store/plan');
    const visit = plan.activePlanVisit.value!;

    plan.setVisitFuelBudget(visit.visitId, 'full-tank');
    // Null is the aggregate tank row: one pooled capacity, which is the whole point — the solver
    // picks the split, and that split is what the plan then has to go store.
    expect(store.effectiveFuelByEggCapacity.value).toBeNull();
    expect(store.effectiveFuelTankCapacity.value).toBe(fuelTankSizes[visit.tankLevel]);

    plan.setVisitFuelBudget(visit.visitId, 'banked');
    expect(store.effectiveFuelByEggCapacity.value!.get(ei.Egg.CURIOSITY)).toBe(4.5e14);
  });

  it('take the plan’s figures over the save’s, and the typed ones over the plan’s', async () => {
    const store = await storeWithVisit(0);
    const plan = await import('@/store/plan');
    const visit = plan.activePlanVisit.value!;

    expect(store.effectiveTankLevel.value).toBe(visit.tankLevel);
    expect(store.effectiveMaxGemCost.value).toBe(gemBudgetFor(visit, store.effectiveWaitTimeSeconds.value));

    // The manual controls stay live on a plan visit rather than going inert: the plan is a source
    // of values, not a lock on them.
    store.setMaxGemCostEnabled(true);
    store.setMaxGemCost(1234);
    expect(store.effectiveMaxGemCost.value).toBe(1234);
    store.setMaxGemCostEnabled(false);

    // Off the plan, the same refs go back to the loaded save's — here, to no save at all.
    plan.setCurrentVisit(null);
    expect(store.effectiveMaxGemCost.value).toBeUndefined();
    expect(store.effectiveTankLevel.value).toBe(fuelTankSizes.length - 1);
  });
});
