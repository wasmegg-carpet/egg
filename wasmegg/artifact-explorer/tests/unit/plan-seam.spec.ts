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
    expect(() => parsePlanSave({ actions: [], initialState: {} })).toThrow(PlanSaveError);
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
