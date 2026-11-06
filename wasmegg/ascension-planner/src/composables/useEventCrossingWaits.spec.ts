import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useActionsStore } from '@/stores/actions';
import { useVirtueStore } from '@/stores/virtue';
import { computeSnapshot } from '@/engine/compute';
import { createBaseEngineState, getSimulationContext } from '@/engine/adapter';
import {
  absoluteSimTimeFor,
  boostTransitionsFrom,
  calculateEarningsForTime,
  getBoostAwareTimeToSave,
  getTimeToSave,
} from '@/engine/apply';
import { useEventCrossingWaits } from './useEventCrossingWaits';
import { simulateHabPurchases } from '@/calculations/habPurchasePlan';
import { planMaxVehicles, planVehiclesForTimeLimit } from '@/calculations/vehiclePurchasePlan';
import { planSilosWithinBudget } from 'lib/planners/calculations/siloPurchasePlan';
import { getNextEarningsBoostEnd, getNextEarningsBoostStart } from 'lib/planners/events';
import { getDiscountedHabPrice, getHabById, type HabId } from '@/lib/habs';
import { generateActionId } from '@/types';

const monday = getNextEarningsBoostStart(Date.UTC(2026, 9, 26) / 1000);
const tuesday = getNextEarningsBoostEnd(monday);

const HAB_MODS = { cheaperContractorsLevel: 0, habCostMultiplier: 1 };
const HAB_MULTIPLIERS = { universalMultiplier: 1, portalMultiplier: 1, habCapMultiplier: 1, artifactMultiplier: 1 };
const VEHICLE_MODS = { bustUnionsLevel: 0, vehicleCostMultiplier: 1 };
const VEHICLE_MULTIPLIERS = {
  universalMultiplier: 1,
  hoverMultiplier: 1,
  hyperloopMultiplier: 1,
  epicMultiplier: 1,
  shippingCapMultiplier: 1,
  artifactMultiplier: 1,
};

async function startPlan(absoluteStart: number) {
  const virtueStore = useVirtueStore();
  virtueStore.setAscensionTimezone('UTC');
  const iso = new Date(absoluteStart * 1000).toISOString();
  virtueStore.setAscensionDate(iso.slice(0, 10));
  virtueStore.setAscensionTime(iso.slice(11, 16));
  const store = useActionsStore();
  const base = {
    ...createBaseEngineState(null),
    currentEgg: 'curiosity' as const,
    habIds: [0, null, null, null],
    vehicles: [{ vehicleId: 0, trainLength: 1 }],
    population: 100,
  };
  await store.setInitialSnapshot(computeSnapshot(base as never, getSimulationContext(), { skipEpochConversion: true }));
  return store;
}

function habCostingSeconds(snapshot: ReturnType<typeof useActionsStore>['currentSnapshot'], min: number, max: number) {
  for (let habId = 1; habId <= 18; habId++) {
    const hab = getHabById(habId as HabId);
    if (!hab) continue;
    const cost = getDiscountedHabPrice(hab, 0, HAB_MODS, false);
    const flatWait = getTimeToSave(cost, snapshot);
    if (flatWait >= min && flatWait <= max) return { habId, cost, flatWait };
  }
  throw new Error(`no hab costs ${min}-${max}s to save for`);
}

// Adds a hab the way the Hab tab does: the 2x waits first, then the purchase.
async function buyHab(habId: number, cost: number) {
  const { prepareExecution, completeExecution, insertBoostCrossingWaits, settled, batch } = useEventCrossingWaits();
  await batch(async () => {
    insertBoostCrossingWaits(cost);
    await settled();
    const before = prepareExecution();
    completeExecution(
      {
        id: generateActionId(),
        timestamp: Date.now(),
        type: 'buy_hab',
        payload: { slotIndex: 1, habId },
        cost,
        dependsOn: [],
      } as never,
      before
    );
  });
  await settled();
}

const addedTypes = (store: ReturnType<typeof useActionsStore>) =>
  store.actions.filter(a => a.type !== 'start_ascension').map(a => a.type);

describe('2x earnings on purchases outside research', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    setActivePinia(createPinia());
  });

  test('saving across the start adds its wait and toggle, and takes the time shown', async () => {
    const probe = await startPlan(monday - 86400);
    const { habId, cost, flatWait } = habCostingSeconds(probe.currentSnapshot, 1800, 6 * 3600);

    setActivePinia(createPinia());
    const store = await startPlan(monday - flatWait / 2);
    const shown = getBoostAwareTimeToSave(cost, store.currentSnapshot, getSimulationContext());
    expect(shown).toBeLessThan(flatWait * 0.9);
    const startedAt = store.currentSnapshot.lastStepTime;

    await buyHab(habId, cost);

    expect(addedTypes(store)).toEqual(['wait_for_earnings_boost', 'toggle_earnings_boost', 'buy_hab']);
    const purchase = store.actions[store.actions.length - 1];
    expect(purchase.endState.lastStepTime - startedAt).toBeCloseTo(shown, 0);
    expect(purchase.endState.earningsBoost.active).toBe(true);
  });

  test('saving across the end adds its own named wait and toggle, and takes the time shown', async () => {
    const probe = await startPlan(tuesday + 3600);
    const { habId, cost, flatWait } = habCostingSeconds(probe.currentSnapshot, 1800, 6 * 3600);

    setActivePinia(createPinia());
    const store = await startPlan(tuesday - flatWait / 4);
    const shown = getBoostAwareTimeToSave(cost, store.currentSnapshot, getSimulationContext());
    const startedAt = store.currentSnapshot.lastStepTime;

    await buyHab(habId, cost);

    expect(addedTypes(store)).toEqual(['wait_for_earnings_boost_end', 'toggle_earnings_boost', 'buy_hab']);
    const purchase = store.actions[store.actions.length - 1];
    expect(purchase.endState.lastStepTime - startedAt).toBeCloseTo(shown, 0);
    expect(purchase.endState.earningsBoost.active).toBe(false);
  });

  test('a purchase crossing nothing adds no waits, and a sale boundary adds none here', async () => {
    const probe = await startPlan(monday - 3 * 86400);
    const { habId, cost } = habCostingSeconds(probe.currentSnapshot, 600, 3600);
    setActivePinia(createPinia());
    const store = await startPlan(monday - 3 * 86400);
    await buyHab(habId, cost);
    expect(addedTypes(store)).toEqual(['buy_hab']);
  });

  test('a plain wait is split at each 2x boundary, keeps its length, and earns what it promised', async () => {
    const start = monday - 3600;
    const seconds = tuesday - start + 7200;
    const store = await startPlan(start);
    const snapshot = store.currentSnapshot;
    const promised = calculateEarningsForTime(
      seconds,
      snapshot,
      boostTransitionsFrom(snapshot, absoluteSimTimeFor(snapshot, getSimulationContext()))
    );
    const { batch, insertWaitAcrossBoost } = useEventCrossingWaits();
    await batch(() => insertWaitAcrossBoost(seconds, 'wait_for_time'));

    expect(addedTypes(store)).toEqual([
      'wait_for_earnings_boost',
      'toggle_earnings_boost',
      'wait_for_earnings_boost_end',
      'toggle_earnings_boost',
      'wait_for_time',
    ]);
    const end = store.currentSnapshot;
    expect(end.lastStepTime - snapshot.lastStepTime).toBeCloseTo(seconds, 3);
    expect(end.earningsBoost.active).toBe(false);
    expect(end.bankValue / promised).toBeCloseTo(1, 6);
  });

  test('a wait crossing nothing stays one plain wait', async () => {
    const store = await startPlan(monday - 3 * 86400);
    const { batch, insertWaitAcrossBoost } = useEventCrossingWaits();
    await batch(() => insertWaitAcrossBoost(3600, 'wait_for_time'));
    expect(addedTypes(store)).toEqual(['wait_for_time']);
  });

  test('a wait without earnings stays that type, earns nothing, and leaves the 2x state right', async () => {
    const start = monday - 3600;
    const store = await startPlan(start);
    const { bankValue, population, lastStepTime } = store.currentSnapshot;
    const { batch, insertWaitAcrossBoost } = useEventCrossingWaits();
    await batch(() => insertWaitAcrossBoost(7200, 'wait_for_no_earnings'));

    expect(addedTypes(store)).toEqual(['wait_for_no_earnings', 'toggle_earnings_boost', 'wait_for_no_earnings']);
    const end = store.currentSnapshot;
    expect(end.lastStepTime - lastStepTime).toBeCloseTo(7200, 3);
    expect(end.earningsBoost.active).toBe(true);
    expect(end.bankValue).toBe(bankValue);
    expect(end.population).toBe(population);
  });

  test('a gems wait crossing 2x recalculates to the time shown and lands on its target', async () => {
    const probe = await startPlan(monday - 86400);
    const { cost: targetGems, flatWait } = habCostingSeconds(probe.currentSnapshot, 1800, 6 * 3600);

    setActivePinia(createPinia());
    const store = await startPlan(monday - flatWait / 2);
    const startedAt = store.currentSnapshot.lastStepTime;
    const shown = getBoostAwareTimeToSave(targetGems, store.currentSnapshot, getSimulationContext());
    expect(shown).toBeLessThan(flatWait * 0.9);
    store.pushAction({
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'wait_for_gems',
      payload: { targetGems, currentGems: 0, requiredGems: targetGems, earningsPerSecond: 0, timeSeconds: flatWait },
      cost: 0,
      dependsOn: [],
    } as never);
    await store.recalculateFrom(0);

    expect(store.currentSnapshot.lastStepTime - startedAt).toBeCloseTo(shown, 0);
    expect(store.currentSnapshot.bankValue / targetGems).toBeCloseTo(1, 6);
  });

  test('multi-step plans count 2x only when given a start time', async () => {
    const start = monday + 3600;
    const store = await startPlan(start);
    const snapshot = store.currentSnapshot;
    const context = getSimulationContext();
    const absolute = absoluteSimTimeFor(snapshot, context);
    const planHabs = (at?: number) =>
      simulateHabPurchases(snapshot, snapshot.habIds, HAB_MODS, false, HAB_MULTIPLIERS, seconds => seconds > 3600, at);
    const planSilos = (at?: number) => planSilosWithinBudget(snapshot, 1, 1e12, at);
    // A Hyperloop is far out of reach for this farm, so scale earnings to land its wait inside the 2x day.
    const earningMore = { ...snapshot, offlineEarnings: snapshot.offlineEarnings * 1e23 };
    const planVehicles = (at?: number) =>
      planMaxVehicles(snapshot.vehicles, 1, 1, VEHICLE_MODS, false, VEHICLE_MULTIPLIERS, earningMore, at);
    const planVehiclesBudget = (at?: number) =>
      planVehiclesForTimeLimit(snapshot.vehicles, 1, 5, VEHICLE_MODS, false, VEHICLE_MULTIPLIERS, 3600, snapshot, at);

    expect(planSilos(absolute).steps[0].waitSeconds).toBeLessThan(planSilos().steps[0].waitSeconds);
    expect(planVehicles(absolute).totalSeconds).toBeLessThan(planVehicles().totalSeconds);
    expect(planVehiclesBudget(absolute).steps.length).toBeGreaterThanOrEqual(planVehiclesBudget().steps.length);
    expect(planHabs(absolute).steps.length).toBeGreaterThanOrEqual(planHabs().steps.length);
    expect(planHabs(absolute).steps[0]?.waitSeconds ?? 0).toBeLessThanOrEqual(planHabs().steps[0]?.waitSeconds ?? 0);
  });
});
