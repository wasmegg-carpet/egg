import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { listFarmPurchaseCandidates, type FarmCandidateOptions } from 'lib/planners/calculations/farmPurchases';
import { createBaseEngineState, getSimulationContext } from 'lib/planners/engine/adapter';
import { computeSnapshot } from 'lib/planners/engine/compute';
import { useInitialStateStore } from '@/stores/initialState';
import { getCommonResearches } from '@/calculations/commonResearch';
import { computeHabSpaceChain } from 'lib/planners/calculations/habSpaceChain';
import { simulateSaleAwareBuy, simulateThresholdBuy } from 'lib/planners/calculations/smartBuyPreview';
import { computeTierMilestoneChain, isResearchChainItem } from 'lib/planners/calculations/milestoneChain';

const NOW = Date.UTC(2026, 10, 9, 18) / 1000;
const OPTIONS: FarmCandidateOptions = {
  includeHabs: true,
  includeVehicles: true,
  mods: { labUpgradeLevel: 0, researchCostMultiplier: 1, puzzleCubeMultiplier: 1 },
  roiDeadline: NOW + 4 * 86400,
};
const LEVELS = { comfy_nests: 50, nutritional_sup: 40, padded_packaging: 30 };
const trike = { vehicleId: 0, trainLength: 1 };
const pickup = { vehicleId: 2, trainLength: 1 };

describe('vehicles and habs as earnings purchases', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    setActivePinia(createPinia());
  });

  function farm(over: { vehicles: { vehicleId: number; trainLength: number }[]; habIds?: number[]; full?: number }) {
    const context = getSimulationContext();
    const habIds = over.habIds ?? [6, 6, 6, 6];
    const base = { ...createBaseEngineState(null), habIds, vehicles: over.vehicles, researchLevels: LEVELS, bankValue: 0 };
    const capacity = computeSnapshot(base, context, { skipEpochConversion: true }).habCapacity;
    const state = { ...base, population: capacity * (over.full ?? 0.5) };
    const snapshot = computeSnapshot(state, context, { skipEpochConversion: true });
    return listFarmPurchaseCandidates(state, snapshot, context, NOW, OPTIONS);
  }

  test('a shipping-capped farm buys the right vehicle for an empty slot, not a run of small upgrades', () => {
    useInitialStateStore().setSoulEggs(1e12);
    const candidates = farm({ vehicles: [trike] });
    const empty = candidates.find(c => c.purchase.kind === 'vehicle' && c.purchase.fromVehicleId === null)!;
    expect(empty.purchase.kind === 'vehicle' && empty.purchase.vehicleId).toBeGreaterThan(1);
    expect(empty.timeToBuySeconds).toBeLessThan(60);
  });

  test('empty slots and slots holding the same vehicle list one purchase each', () => {
    useInitialStateStore().setSoulEggs(1e6);
    const candidates = farm({ vehicles: [trike] });
    const slots = candidates.filter(c => c.purchase.kind === 'vehicle').map(c => c.purchase.slotIndex);
    expect(slots).toEqual([0, 1]);
  });

  test('with every slot in use, fleet research is paired with a vehicle for the slot it adds', () => {
    useInitialStateStore().setSoulEggs(1e6);
    const candidates = farm({ vehicles: [pickup, pickup, pickup, pickup] });
    const pair = candidates.find(c => c.purchase.kind === 'vehicle' && c.purchase.fleetResearch);
    expect(pair).toBeDefined();
    expect(pair!.purchase.slotIndex).toBe(4);
    expect(pair!.steps.map(step => step.type)).toEqual(['buy_research', 'buy_vehicle']);
    expect(isFinite(pair!.totalRoiSeconds)).toBe(true);
  });

  test('vehicle purchases are never held back by the research sale', () => {
    useInitialStateStore().setSoulEggs(1e6);
    const candidates = farm({ vehicles: [trike] });
    expect(candidates.every(c => !c.showSaleWarning)).toBe(true);
  });

  test('a bigger hab pays back once the habs are full', () => {
    useInitialStateStore().setSoulEggs(1e6);
    const pickups = Array(4).fill(pickup);
    const full = farm({ vehicles: pickups, habIds: [2, 2, 2, 2], full: 1 });
    expect(full.some(c => c.purchase.kind === 'hab' && isFinite(c.totalRoiSeconds))).toBe(true);
  });

  function shippingCappedSnapshot(full: number) {
    const context = getSimulationContext();
    const base = { ...createBaseEngineState(null), habIds: [6, 6, 6, 6], vehicles: [trike], researchLevels: LEVELS, bankValue: 0 };
    const capacity = computeSnapshot(base, context, { skipEpochConversion: true }).habCapacity;
    return computeSnapshot({ ...base, population: capacity * full }, context, { skipEpochConversion: true });
  }

  test('the hab space chain buys vehicles as earnings detours, never habs', () => {
    useInitialStateStore().setSoulEggs(1e6);
    const chain = computeHabSpaceChain(shippingCappedSnapshot(0.5), getSimulationContext(), OPTIONS.mods, NOW, NOW + 6 * 86400);
    const farmItems = chain.items.filter(item => !isResearchChainItem(item));
    expect(farmItems.length).toBeGreaterThan(0);
    for (const item of farmItems) expect(!isResearchChainItem(item) && item.purchase.kind).not.toBe('hab');
  });

  test('the tier milestone buys vehicles on the way when they pay back first', () => {
    useInitialStateStore().setSoulEggs(1e6);
    const chain = computeTierMilestoneChain(
      { tier: 4 },
      shippingCappedSnapshot(0.5),
      getSimulationContext(),
      OPTIONS.mods,
      NOW,
      NOW + 6 * 86400
    );
    expect(chain.reached).toBe(true);
    expect(chain.items.some(item => !isResearchChainItem(item))).toBe(true);
  });

  test("Smart Buy's 70% Return plan buys vehicles when they pay back first", () => {
    useInitialStateStore().setSoulEggs(1e6);
    const snapshot = shippingCappedSnapshot(0.5);
    const plan = simulateSaleAwareBuy(
      snapshot.researchLevels,
      snapshot,
      getSimulationContext(),
      OPTIONS.mods,
      NOW,
      NOW + 6 * 86400,
      NOW + 4 * 86400,
      'immediate',
      false,
      undefined,
      NOW + 4 * 86400
    );
    const farmEntries = plan.entries.filter(entry => entry.farm);
    expect(farmEntries.length).toBeGreaterThan(0);
    expect(farmEntries.every(entry => !entry.duringSale)).toBe(true);
  });

  test('Quick Buy buys cheap vehicles that pay for themselves, alongside research', () => {
    useInitialStateStore().setSoulEggs(1e6);
    const snapshot = shippingCappedSnapshot(0.5);
    const plan = simulateThresholdBuy(snapshot.researchLevels, snapshot, getSimulationContext(), OPTIONS.mods, false, 3600);
    const farm = (plan.purchases ?? []).filter(purchase => 'farm' in purchase);
    expect(farm.length).toBeGreaterThan(0);
    expect(plan.purchases!.length).toBe(plan.researchIds.length + farm.length);
  });

  test('with every train full, Graviton Coupling is paired with one more car', () => {
    useInitialStateStore().setSoulEggs(1e21);
    const context = getSimulationContext();
    const researchLevels = Object.fromEntries(getCommonResearches().map(r => [r.id, r.levels]));
    researchLevels.micro_coupling = 0;
    const base = { ...createBaseEngineState(null), habIds: [18, 18, 18, 18], researchLevels, bankValue: 0 };
    const slots = computeSnapshot(base, context, { skipEpochConversion: true });
    const vehicles = Array.from({ length: 17 }, () => ({ vehicleId: 11, trainLength: 5 }));
    const capped = { ...base, vehicles, population: slots.habCapacity };
    const snapshot = computeSnapshot(capped, context, { skipEpochConversion: true });
    expect(snapshot.shippingCapacity).toBeLessThan(snapshot.layRate);
    const candidates = listFarmPurchaseCandidates(capped, snapshot, context, NOW, OPTIONS);
    const pair = candidates.find(c => c.purchase.kind === 'train_car');
    expect(pair).toBeDefined();
    expect(pair!.purchase.kind === 'train_car' && pair!.purchase.couplingResearch?.researchId).toBe('micro_coupling');
    expect(pair!.steps.map(step => step.type)).toEqual(['buy_research', 'buy_train_car']);
    expect(pair!.purchase.kind === 'train_car' && pair!.purchase.toLength).toBe(6);
  });

  test('a train with room left gets a plain car, not a Graviton Coupling pair', () => {
    useInitialStateStore().setSoulEggs(1e21);
    const context = getSimulationContext();
    const researchLevels = Object.fromEntries(getCommonResearches().map(r => [r.id, r.levels]));
    researchLevels.micro_coupling = 0;
    const vehicles = [...Array.from({ length: 16 }, () => ({ vehicleId: 11, trainLength: 5 })), { vehicleId: 11, trainLength: 4 }];
    const base = { ...createBaseEngineState(null), habIds: [18, 18, 18, 18], researchLevels, vehicles, bankValue: 0 };
    const capacity = computeSnapshot(base, context, { skipEpochConversion: true }).habCapacity;
    const state = { ...base, population: capacity };
    const snapshot = computeSnapshot(state, context, { skipEpochConversion: true });
    const cars = listFarmPurchaseCandidates(state, snapshot, context, NOW, OPTIONS).filter(c => c.purchase.kind === 'train_car');
    expect(cars.length).toBeGreaterThan(0);
    expect(cars.every(c => c.purchase.kind === 'train_car' && !c.purchase.couplingResearch)).toBe(true);
  });
});
