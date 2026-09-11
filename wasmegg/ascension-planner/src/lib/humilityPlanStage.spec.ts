import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { allResearches, ei, shiftCost } from 'lib';
import { createBaseEngineState, getSimulationContext } from '@/engine/adapter';
import { createEmptySnapshot, createSimAction, type Action, type CurrentFarmState, type VirtueEgg } from '@/types';
import { useActionsStore } from '@/stores/actions';
import { exportPlanData } from '@/stores/actions/io';
import { useInitialStateStore } from '@/stores/initialState';
import { useHumilityPlanStore } from '@/stores/humilityPlan';
import { humilitySourceTag, stageHumilityVisit } from './humilityPlanStage';
import { fuelForLaunches } from './rockets/launches';
import { resolveLaunches, type HumilityPlanVisit } from './humilityPlan';

vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} }));
beforeEach(() => setActivePinia(createPinia()));

function baseState() {
  const snapshot = createEmptySnapshot();
  snapshot.tankLevel = 7;
  snapshot.soulEggs = 1e20;
  snapshot.habIds = [18, 18, 18, 18];
  snapshot.researchLevels = Object.fromEntries(allResearches.map(research => [research.id, research.levels]));
  return createBaseEngineState(snapshot);
}

function shift(toEgg: VirtueEgg, id: string = toEgg): Action<'shift'> {
  return { ...createSimAction('shift', { fromEgg: 'curiosity', toEgg, newShiftCount: 0 }), id };
}

function plan(eggs: VirtueEgg[] = ['curiosity', 'humility']): Action[] {
  return [
    createSimAction('start_ascension', { initialEgg: eggs[0] }),
    ...eggs.slice(1).map(egg => shift(egg)),
    createSimAction('modify_bank', { mode: 'set', amount: 1e60, previousValue: 0, delta: 1e60 }),
  ];
}

function visit(ship = 'CHICKEN_ONE', count = 6): HumilityPlanVisit {
  return {
    visitId: 'humility',
    visitIndex: 0,
    label: 'H1',
    jointProbability: 0.5,
    launches: [{ ship, count, duration: ship === 'ATREGGIES' ? 'EPIC' : 'SHORT', targetAfxId: 0 }],
    makespanSeconds: 172800,
    fuelRequired: {},
    gemCost: 0,
    gemBudget: 1e60,
  };
}

function stage(actions = plan(), v = visit(), base = baseState()) {
  return stageHumilityVisit(actions, v, base, getSimulationContext()).actions;
}

// Two Humility visits with a fuel egg's only phase ahead of the first of them, so the second
// visit's fuel has to be stored across the first visit's launch.
function twoVisitPlan(): Action[] {
  return [
    createSimAction('start_ascension', { initialEgg: 'curiosity' }),
    shift('kindness', 'k1'),
    shift('humility', 'h1'),
    shift('curiosity', 'c2'),
    shift('humility', 'h2'),
    createSimAction('modify_bank', { mode: 'set', amount: 1e60, previousValue: 0, delta: 1e60 }),
  ];
}

function storedAmounts(actions: Action[], tag: string, egg: VirtueEgg): number[] {
  return actions
    .filter(a => a.type === 'store_fuel')
    .filter(a => a.sourceTag === tag && a.payload.egg === egg)
    .map(a => a.payload.amount);
}

function totalFuel(amounts: Record<VirtueEgg, number>): number {
  return Object.values(amounts).reduce((a, b) => a + b, 0);
}

function verifyFuelEggs(actions: Action[]) {
  actions.forEach((action, i) => {
    if (action.type === 'store_fuel') expect(action.payload.egg).toBe(actions[i - 1].endState.currentEgg);
    expect(totalFuel(action.endState.fuelTankAmounts)).toBeLessThanOrEqual(500e12);
  });
}

describe('staging a Humility visit', () => {
  it('stores missing fuel in an existing egg visit before the incoming Humility shift', () => {
    const actions = plan(['integrity', 'curiosity', 'humility']);
    const result = stage(actions, visit('BCR'));
    verifyFuelEggs(result);
    const fuelIndex = result.findIndex(a => a.type === 'store_fuel' && a.payload.egg === 'integrity');
    expect(fuelIndex).toBe(1);
    expect(result[fuelIndex + 1].id).toBe('curiosity');
    expect(result.filter(a => a.type === 'shift')).toHaveLength(2);
  });

  it('adds missing egg phases immediately before Humility and refreshes later shifts', () => {
    const original = [...plan(), shift('integrity', 'later')];
    const result = stage(original, visit('ATREGGIES', 1));
    verifyFuelEggs(result);
    const arrival = result.findIndex(a => a.id === 'humility');
    expect(result.slice(arrival - 6, arrival).map(a => a.type)).toEqual([
      'shift',
      'wait_for_full_habs',
      'store_fuel',
      'shift',
      'wait_for_full_habs',
      'store_fuel',
    ]);
    expect(
      result
        .slice(arrival - 6, arrival)
        .filter(a => a.type === 'shift')
        .map(a => a.payload.toEgg)
    ).toEqual(['resilience', 'kindness']);
    const shifts = result.filter(a => a.type === 'shift');
    expect(shifts.map(a => a.payload.newShiftCount)).toEqual([1, 2, 3, 4]);
    expect(shifts.find(a => a.id === 'humility')?.payload.fromEgg).toBe('kindness');
    result.forEach((a, i) => {
      if (a.type === 'shift')
        expect(a.cost).toBe(shiftCost(result[i - 1].endState.soulEggs, result[i - 1].endState.shiftCount));
    });
  });

  it('opens each new egg phase with a wait for full habs, so its fuel is stored on a full farm', () => {
    const v = { ...visit('ATREGGIES', 1), visitId: 'start' };
    const actions = plan(['humility']);
    actions[0].id = 'start';
    const result = stage(actions, v);
    const opened = result.filter(a => a.type === 'shift' && a.sourceTag === humilitySourceTag('start'));
    expect(opened.length).toBeGreaterThan(0);
    for (const opening of opened) {
      const index = result.indexOf(opening);
      expect(result.slice(index + 1, index + 3).map(a => a.type)).toEqual(['wait_for_full_habs', 'store_fuel']);
      const beforeStore = result[index + 1].endState;
      expect(beforeStore.population / beforeStore.habCapacity).toBeCloseTo(1);
    }
    verifyFuelEggs(result);
  });

  it('preserves unrelated actions and is idempotent when restaged', () => {
    const once = stage(plan(), visit('ATREGGIES', 1));
    const twice = stage(once, visit('ATREGGIES', 1));
    const content = (actions: Action[]) =>
      actions.map(a => ({ type: a.type, payload: a.payload, cost: a.cost, endState: a.endState }));
    expect(content(twice)).toEqual(content(once));
    expect(twice.filter(a => a.type === 'modify_bank').map(a => a.id)).toEqual(
      once.filter(a => a.type === 'modify_bank').map(a => a.id)
    );
    verifyFuelEggs(twice);
  });

  it('accounts for intervening fuel consumption that was previously clamped to zero', () => {
    const v = visit('BCR');
    const amount = fuelForLaunches(resolveLaunches(v)).integrity;
    const actions = plan(['integrity', 'curiosity', 'humility']);
    actions.splice(2, 0, createSimAction('remove_fuel', { egg: 'integrity', amount: 123 }));
    const result = stage(actions, v);
    const stored = result.find(a => a.type === 'store_fuel' && a.payload.egg === 'integrity');
    expect(stored?.type === 'store_fuel' && stored.payload.amount).toBe(amount + 123);
    const launchIndex = result.findIndex(a => a.type === 'launch_missions');
    expect(result[launchIndex - 1].endState.fuelTankAmounts.integrity).toBe(amount);
  });

  it('accepts the 495T non-Humility plan whose fuel totals 720T with Humility counted', () => {
    const result = stage(plan(), visit('ATREGGIES', 3));
    verifyFuelEggs(result);
    expect(result.some(a => a.type === 'launch_missions')).toBe(true);
  });

  it('leaves Humility to the farm instead of storing it before the launch', () => {
    const result = stage(plan(), visit('BCR'));
    const stored = result.filter(a => a.type === 'store_fuel').map(a => a.payload.egg);
    expect(stored).toEqual(['integrity']);
  });

  it('rejects overflow caused by unrelated banked fuel, before altering a previous staging', async () => {
    const actions = useActionsStore();
    const base = baseState();
    base.fuelTankAmounts.integrity = 400e12;
    actions._initialSnapshot = { ...createEmptySnapshot(), ...base };
    const once = stage(plan(), visit(), base);
    actions.actions = once;
    const before = JSON.stringify(actions.actions);
    await expect(useHumilityPlanStore().stage(visit('ATREGGIES', 1))).rejects.toThrow(/overflow/);
    expect(JSON.stringify(actions.actions)).toBe(before);
  });

  it('caps a store by the tank space it has to pass through, not only the space at the launch', () => {
    const base = baseState();
    base.fuelTankAmounts.integrity = 499e12;
    const actions = plan(['curiosity', 'integrity', 'humility']);
    actions.splice(2, 0, createSimAction('remove_fuel', { egg: 'integrity', amount: 499e12 }));
    const result = stage(actions, visit('ATREGGIES', 1), base);
    verifyFuelEggs(result);
    // The tank is full to 1T while the banked Integrity is still in it, so that is all the
    // Curiosity phase can take; the rest waits for a phase of its own.
    expect(storedAmounts(result, humilitySourceTag('humility'), 'curiosity')).toEqual([1e12, 49e12]);
  });

  it('splits fuel for a later visit around an earlier launch instead of overflowing it', () => {
    const tag = humilitySourceTag('h2');
    const first = stage(twoVisitPlan(), { ...visit('ATREGGIES', 2), visitId: 'h1' });
    const second = stage(first, { ...visit('ATREGGIES', 3), visitId: 'h2', visitIndex: 1 });
    verifyFuelEggs(second);
    expect(second.filter(a => a.type === 'launch_missions')).toHaveLength(2);
    // The first visit holds 330T in the tank until its launch. The second visit's Resilience claims
    // the 170T left over, and its Kindness takes the 50T still free after that; the rest of the
    // Kindness waits for a phase of its own, after the first launch has emptied its share.
    expect(storedAmounts(second, tag, 'resilience')).toEqual([120e12]);
    expect(storedAmounts(second, tag, 'kindness')).toEqual([50e12, 175e12]);
    const firstLaunch = second.findIndex(a => a.type === 'launch_missions');
    expect(totalFuel(second[firstLaunch - 1].endState.fuelTankAmounts)).toBe(500e12);
    const launchIndex = second.findIndex(a => a.type === 'launch_missions' && a.sourceTag === tag);
    const tank = second[launchIndex - 1].endState.fuelTankAmounts;
    const required = fuelForLaunches(resolveLaunches(visit('ATREGGIES', 3)));
    for (const egg of ['curiosity', 'kindness', 'resilience'] as VirtueEgg[]) expect(tank[egg]).toBe(required[egg]);
  });

  it('rejects the plan when the split still cannot fit, leaving the plan untouched', async () => {
    const actions = useActionsStore();
    const base = baseState();
    base.fuelTankAmounts.integrity = 100e12;
    actions._initialSnapshot = { ...createEmptySnapshot(), ...base };
    actions.actions = stage(twoVisitPlan(), { ...visit('ATREGGIES', 1), visitId: 'h1' }, base);
    const before = JSON.stringify(actions.actions);
    await expect(useHumilityPlanStore().stage({ ...visit('ATREGGIES', 3), visitId: 'h2' })).rejects.toThrow(/overflow/);
    expect(JSON.stringify(actions.actions)).toBe(before);
  });

  it('adds a wait after the launch to fill the exported window', () => {
    const result = stage();
    const index = result.findIndex(a => a.type === 'launch_missions');
    expect(result[index].totalTimeSeconds).toBe(2400);
    expect(result[index + 1].type).toBe('wait_for_time');
    expect(result[index + 1].totalTimeSeconds).toBe(172800 - 2400);
    expect(result[index + 1].sourceTag).toBe(humilitySourceTag('humility'));
  });

  it('does not add a negative wait when launches exceed the exported window', () => {
    const result = stage(plan(), { ...visit(), makespanSeconds: 1 });
    expect(result.some(a => a.type === 'wait_for_time')).toBe(false);
  });

  it('allows a fully banked visit starting on Humility', () => {
    const v = { ...visit(), visitId: 'start' };
    const base = baseState();
    base.fuelTankAmounts = fuelForLaunches(resolveLaunches(v));
    const actions = plan(['humility']);
    actions[0].id = 'start';
    expect(stage(actions, v, base).some(a => a.type === 'launch_missions')).toBe(true);
  });
  it('moves the initial farm to a fuel egg and keeps existing actions under the new Humility shift', () => {
    const v = { ...visit('BCR'), visitId: 'start' };
    const actions = plan(['humility']);
    actions[0].id = 'start';
    const result = stage(actions, v);
    expect(result[0].type).toBe('start_ascension');
    expect(result[0].type === 'start_ascension' && result[0].payload.initialEgg).toBe('integrity');
    expect(result[0].id).not.toBe('start');
    const arrival = result.findIndex(a => a.id === 'start');
    expect(result[arrival].type).toBe('shift');
    expect(result[arrival].endState.currentEgg).toBe('humility');
    expect(result[arrival + 1].id).toBe(actions[1].id);
    verifyFuelEggs(result);
    expect(stage(result, v).map(a => a.type)).toEqual(result.map(a => a.type));
  });

  it('publishes a successful staging with rebuilt dependency links', async () => {
    const actions = useActionsStore();
    actions._initialSnapshot = { ...createEmptySnapshot(), ...baseState() };
    actions.actions = plan(['integrity', 'humility']);
    await useHumilityPlanStore().stage(visit('BCR'));
    verifyFuelEggs(actions.actions);
    const fuel = actions.actions.find(a => a.type === 'store_fuel' && a.payload.egg === 'integrity')!;
    expect(fuel.dependsOn).toContain(actions.actions[0].id);
    expect(actions.actions[0].dependents).toContain(fuel.id);
    expect(useHumilityPlanStore().isStaged(visit())).toBe(true);
  });

  it('preserves the initial farm and snapshot except for the starting egg, including on export', async () => {
    const actions = useActionsStore();
    const initialState = useInitialStateStore();
    const snapshot = {
      ...createEmptySnapshot(),
      ...baseState(),
      currentEgg: 'humility' as const,
      bankValue: 1e60,
      population: 12345,
      siloCount: 2,
    };
    const farm: CurrentFarmState = {
      eggType: ei.Egg.HUMILITY,
      cash: snapshot.bankValue,
      cashEarned: 2e60,
      cashSpent: 1e60,
      population: snapshot.population,
      deliveredEggs: 54321,
      lastStepTime: 0,
      numSilos: snapshot.siloCount,
      commonResearches: { ...snapshot.researchLevels },
      habs: [...snapshot.habIds],
      vehicles: [...snapshot.vehicles],
    };
    actions._initialSnapshot = snapshot;
    initialState.currentFarmState = farm;
    actions.actions = [
      { ...createSimAction('start_ascension', { initialEgg: 'humility', initialFarmState: farm }), id: 'start' },
      ...plan(['humility']).slice(1),
    ];
    const existingActionId = actions.actions[1].id;
    const v = { ...visit('BCR'), visitId: 'start' };
    await useHumilityPlanStore().stage(v);
    const expectedFarm = { ...farm, eggType: ei.Egg.INTEGRITY };
    expect(initialState.currentFarmState).toEqual(expectedFarm);
    expect(actions._initialSnapshot).toEqual({ ...snapshot, currentEgg: 'integrity' });
    const start = actions.actions[0];
    expect(start.type === 'start_ascension' && start.payload.initialFarmState).toEqual(expectedFarm);
    expect(start.endState.population).toBe(farm.population);
    expect(start.endState.bankValue).toBe(farm.cash);
    const arrivalIndex = actions.actions.findIndex(a => a.id === v.visitId);
    expect(actions.actions[arrivalIndex + 1].id).toBe(existingActionId);
    const exported = exportPlanData(actions.actions, actions._initialSnapshot!);
    expect(exported.initialState.currentFarmState).toEqual(expectedFarm);
    expect(exported.actions[0].payload).toEqual(start.payload);
    await useHumilityPlanStore().stage(v);
    expect(initialState.currentFarmState).toEqual(expectedFarm);
    expect(actions.actions.filter(a => a.id === existingActionId)).toHaveLength(1);
    expect(farm.eggType).toBe(ei.Egg.HUMILITY);
  });

  it('leaves the starting egg and plan intact when the new fuel phases overflow the tank', async () => {
    const actions = useActionsStore();
    const base = baseState();
    base.currentEgg = 'humility';
    base.fuelTankAmounts.integrity = 400e12;
    actions._initialSnapshot = { ...createEmptySnapshot(), ...base };
    actions.actions = plan(['humility']);
    const v = { ...visit('ATREGGIES', 1), visitId: actions.actions[0].id };
    const before = JSON.stringify({ actions: actions.actions, snapshot: actions._initialSnapshot });
    await expect(useHumilityPlanStore().stage(v)).rejects.toThrow(/overflow/);
    expect(JSON.stringify({ actions: actions.actions, snapshot: actions._initialSnapshot })).toBe(before);
  });
});
