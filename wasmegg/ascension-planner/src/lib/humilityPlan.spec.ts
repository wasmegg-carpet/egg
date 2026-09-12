// The planner half of the artifact-explorer seam. Reads the same two fixtures the explorer's
// `tests/unit/plan-seam.spec.ts` reads, from the explorer's tree — one copy, two readers, so the
// schema has an executable definition rather than two prose ones. See the README beside them.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  fuelShortfalls,
  humilityVisitIds,
  humilityVisitInsertIndex,
  launchLabel,
  launchSchedule,
  stageableVisitIds,
  fuelDrift,
  HumilityPlanError,
  parseHumilityPlan,
  resolveLaunches,
  type HumilityPlanFile,
} from './humilityPlan';
import { fuelForLaunches, launchCost } from './rockets/launches';
import { DURATION_NAMES, DurationType, SHIP_INFO, Spaceship, VIRTUE_FUEL_REQUIREMENTS } from './missions';
import { VIRTUE_EGGS } from '@/types';
import type { Action } from '@/types';

const FIXTURES = new URL('../../../artifact-explorer/tests/fixtures/', import.meta.url).pathname;

const humilityPlan = () => parseHumilityPlan(JSON.parse(readFileSync(FIXTURES + 'humility-plan.json', 'utf8')));
const planSave = JSON.parse(readFileSync(FIXTURES + 'ascension-plan.json', 'utf8')) as { actions: Action[] };

describe('parsing a humility plan', () => {
  it('accepts the fixture the explorer writes', () => {
    const file = humilityPlan();
    expect(file.visits.map(v => v.visitId)).toEqual(['shift_a1b2c3d', 'shift_e5e5e5e']);
  });

  it('refuses anything that is not this schema, at this version', () => {
    const file = humilityPlan() as HumilityPlanFile;
    expect(() => parseHumilityPlan({ ...file, schema: 'something.else' })).toThrow(HumilityPlanError);
    expect(() => parseHumilityPlan({ ...file, schemaVersion: 2 })).toThrow(/version 2/);
    expect(() => parseHumilityPlan({ ...file, visits: [] })).toThrow(/no solved visits/);
  });
  it.each([null, [], { visitId: 'v1' }])('rejects a malformed visit before it reaches the panel: %j', visit => {
    expect(() => parseHumilityPlan({ ...humilityPlan(), visits: [visit] })).toThrow(HumilityPlanError);
  });

  it.each([
    ['visitId', ''],
    ['label', null],
    ['visitIndex', 0.5],
    ['visitIndex', -1],
    ['jointProbability', 1.1],
    ['jointProbability', -0.1],
    ['makespanSeconds', Infinity],
    ['makespanSeconds', '12'],
    ['gemCost', NaN],
    ['gemBudget', -1],
    ['fuelRequired', []],
    ['fuelRequired', { curiosity: -1 }],
    ['fuelRequired', { bogus: 1 }],
    ['launches', null],
    ['launches', [null]],
  ])('validates %s before accepting the file', (field, value) => {
    const file = humilityPlan();
    (file.visits[0] as unknown as Record<string, unknown>)[field] = value;
    expect(() => parseHumilityPlan(file)).toThrow(HumilityPlanError);
  });

  it.each([
    { count: '2' },
    { count: true },
    { count: 1.5 },
    { targetAfxId: null },
    { targetAfxId: '25' },
    { targetAfxId: 99999 },
    { targetAfxId: 0.5 },
    { duration: 'toString' },
    { duration: 'TUTORIAL' },
    { ship: 'missing' },
  ])('validates each launch while loading: %j', fields => {
    const file = humilityPlan();
    Object.assign(file.visits[0].launches[0], fields);
    expect(() => parseHumilityPlan(file)).toThrow(HumilityPlanError);
  });

  it('rejects duplicate visit ids and indices', () => {
    const file = humilityPlan();
    file.visits[1].visitId = file.visits[0].visitId;
    expect(() => parseHumilityPlan(file)).toThrow(/Duplicate/);
    file.visits[1].visitId = 'different';
    file.visits[1].visitIndex = file.visits[0].visitIndex;
    expect(() => parseHumilityPlan(file)).toThrow(/Duplicate/);
  });

  it('accepts an empty launch list for a solution satisfied by existing inventory', () => {
    const file = humilityPlan();
    file.visits[0].launches = [];
    expect(parseHumilityPlan(file).visits[0].launches).toEqual([]);
  });
});

describe('mapping the wire format onto this app’s enums', () => {
  it('reads ships and durations by name, not by number', () => {
    const [visit] = humilityPlan().visits;
    const launches = resolveLaunches(visit);
    expect(launches).toEqual([
      { ship: Spaceship.HENERPRISE, duration: DurationType.LONG, targetAfxId: 25, count: 4 },
      { ship: Spaceship.ATREGGIES, duration: DurationType.EPIC, targetAfxId: 25, count: 9 },
    ]);
  });

  it('does not silently read the protobuf’s EPIC as this app’s', () => {
    // The collision this seam exists to avoid: the protobuf numbers EPIC 2 and TUTORIAL 3, this
    // app numbers EPIC 3. A file carrying the integer 3 would mean two different missions.
    expect(DurationType.EPIC).toBe(3);
    const [visit] = humilityPlan().visits;
    const withInteger = { ...visit, launches: [{ ...visit.launches[0], duration: 3 as unknown as string }] };
    expect(() => resolveLaunches(withInteger)).toThrow(HumilityPlanError);
  });

  it('rejects a duration it cannot plan rather than defaulting one', () => {
    const [visit] = humilityPlan().visits;
    const tutorial = { ...visit, launches: [{ ...visit.launches[0], duration: 'TUTORIAL' }] };
    expect(() => resolveLaunches(tutorial)).toThrow(/TUTORIAL/);
  });

  it('rejects an unknown ship rather than dropping it from the plan', () => {
    const [visit] = humilityPlan().visits;
    const bogus = { ...visit, launches: [{ ...visit.launches[0], ship: 'CHICKEN_TWELVE' }] };
    expect(() => resolveLaunches(bogus)).toThrow(/CHICKEN_TWELVE/);
  });

  it('lists a launch under the names the mission grid uses', () => {
    const [visit] = humilityPlan().visits;
    expect(visit.launches.map(launchLabel)).toEqual([
      `${DURATION_NAMES[DurationType.LONG]} ${SHIP_INFO[Spaceship.HENERPRISE].displayName}`,
      `${DURATION_NAMES[DurationType.EPIC]} ${SHIP_INFO[Spaceship.ATREGGIES].displayName}`,
    ]);
    // The list renders before staging validates it, so a name we cannot map shows as it came
    // rather than taking the row down.
    expect(launchLabel({ ...visit.launches[0], ship: 'CHICKEN_TWELVE' })).toBe('LONG CHICKEN_TWELVE');
  });

  it('rejects a count that would launch nothing or a fraction of a ship', () => {
    const [visit] = humilityPlan().visits;
    for (const count of [0, -1, 1.9, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      const bad = { ...visit, launches: [{ ...visit.launches[0], count }] };
      expect(() => resolveLaunches(bad)).toThrow(HumilityPlanError);
    }
  });
});

describe('fuel', () => {
  it('adds back the Humility the explorer strips, from this app’s own table', () => {
    const [visit] = humilityPlan().visits;
    const ours = fuelForLaunches(resolveLaunches(visit));

    // The file has no humility key at all; the tank is charged for it here, so an importer that
    // copied the file's figures straight across would under-deduct.
    expect(visit.fuelRequired).not.toHaveProperty('humility');
    const expectedHumility =
      VIRTUE_FUEL_REQUIREMENTS[Spaceship.ATREGGIES][DurationType.EPIC].find(r => r.egg === 'humility')!.amount * 9 +
      VIRTUE_FUEL_REQUIREMENTS[Spaceship.HENERPRISE][DurationType.LONG].find(r => r.egg === 'humility')!.amount * 4;
    expect(ours.humility).toBe(expectedHumility);
    expect(ours.humility).toBeGreaterThan(0);
  });

  it('agrees with the explorer on the four eggs it does report', () => {
    // This is the tripwire, and it passing is the claim that the two tables have not drifted.
    for (const visit of humilityPlan().visits) {
      expect(fuelDrift(visit, fuelForLaunches(resolveLaunches(visit)))).toEqual([]);
    }
  });

  it('reports drift instead of reconciling it', () => {
    const [visit] = humilityPlan().visits;
    const ours = fuelForLaunches(resolveLaunches(visit));
    const drifted = { ...visit, fuelRequired: { ...visit.fuelRequired, curiosity: ours.curiosity * 1.5 } };
    expect(fuelDrift(drifted, ours)).toEqual([
      { egg: 'curiosity', ours: ours.curiosity, theirs: ours.curiosity * 1.5 },
    ]);
  });

  it('does not mistake float noise for drift', () => {
    const [visit] = humilityPlan().visits;
    const ours = fuelForLaunches(resolveLaunches(visit));
    const nudged = { ...visit, fuelRequired: { ...visit.fuelRequired, curiosity: ours.curiosity * (1 + 1e-12) } };
    expect(fuelDrift(nudged, ours)).toEqual([]);
  });
});

describe('finding the visits a file was solved for', () => {
  const actions = planSave.actions;

  it('keys on the action that entered Humility, the same rule the explorer slices by', () => {
    expect(humilityVisitIds(actions)).toEqual(['shift_a1b2c3d', 'shift_e5e5e5e']);
    expect(humilityVisitIds([])).toEqual([]);
    // A run is keyed once, not once per action in it.
    expect(humilityVisitIds(actions.slice(0, 3))).toEqual(['shift_a1b2c3d']);
  });

  it('matches every visit id the explorer wrote into the plan file', () => {
    // The join key, end to end: what the explorer put in the file is findable in the save it read.
    const ids = new Set(humilityVisitIds(actions));
    for (const visit of humilityPlan().visits) {
      expect(ids.has(visit.visitId)).toBe(true);
    }
  });

  it('lands the launch at the end of the visit, after what the plan already does there', () => {
    // Visit 1 runs actions 1-2, so its launch goes at 3, before the shift away.
    expect(humilityVisitInsertIndex(actions, 'shift_a1b2c3d')).toBe(3);
    // Visit 2 is the last thing in the plan; its launch goes at the end.
    expect(humilityVisitInsertIndex(actions, 'shift_e5e5e5e')).toBe(actions.length);
    expect(humilityVisitInsertIndex(actions, 'shift_gone')).toBeNull();
  });

  it('withholds every visit after one the plan has lost, not just that one', () => {
    const file = humilityPlan();
    const stageable = (plan: Action[]) => stageableVisitIds(file, humilityVisitIds(plan));
    expect(stageable(actions)).toEqual(new Set(['shift_a1b2c3d', 'shift_e5e5e5e']));

    // The second visit is still in the plan, but the answers were solved as a sequence and the
    // plan they were solved against no longer exists once the first one is gone.
    expect(stageable(actions.filter(a => a.id !== 'shift_a1b2c3d'))).toEqual(new Set());

    expect(stageable(actions.filter(a => a.id !== 'shift_e5e5e5e'))).toEqual(new Set(['shift_a1b2c3d']));
  });
});

describe('what staging a visit costs', () => {
  it('stores only what the tank is short of, not the whole requirement', () => {
    const [visit] = humilityPlan().visits;
    const required = fuelForLaunches(resolveLaunches(visit));

    expect(fuelShortfalls(required, required)).toEqual([]);
    expect(fuelShortfalls(required, {})).toEqual(
      VIRTUE_EGGS.filter(egg => required[egg] > 0).map(egg => ({ egg, amount: required[egg] }))
    );
    const half = { ...required, curiosity: required.curiosity / 2 };
    expect(fuelShortfalls(required, half)).toContainEqual({ egg: 'curiosity', amount: required.curiosity / 2 });
  });

  it('schedules the makespan here, because the FTL level it depends on lives here', () => {
    const [visit] = humilityPlan().visits;
    const launches = resolveLaunches(visit);
    const totalShips = launches.reduce((sum, l) => sum + l.count, 0);

    const noFtl = launchSchedule(launches, 0);
    expect(noFtl.totalMissions).toBe(totalShips);
    expect(noFtl.totalSeconds).toBeGreaterThan(0);
    // FTL shortens the file's figure, so copying `makespanSeconds` across would overstate the plan.
    expect(launchSchedule(launches, 60).totalSeconds).toBeLessThan(noFtl.totalSeconds);
  });

  it('prices the launch from this app’s ship prices', () => {
    const [visit] = humilityPlan().visits;
    const launches = resolveLaunches(visit);
    expect(launchCost(launches)).toBe(launches.reduce((cost, l) => cost + SHIP_INFO[l.ship].price * l.count, 0));
    expect(launchCost(launches)).toBeGreaterThan(0);
  });
});
