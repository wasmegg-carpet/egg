import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  computeHabSpaceChain,
  listHabSpaceCandidates,
  pickHabSpaceTarget,
  secondsUntilHabsFull,
  HAB_CAPACITY_RESEARCH_IDS,
  type HabSpaceCandidate,
} from 'lib/planners/calculations/habSpaceChain';
import { createBaseEngineState, getSimulationContext } from 'lib/planners/engine/adapter';
import { computeSnapshot } from 'lib/planners/engine/compute';
import { useInitialStateStore } from '@/stores/initialState';
import { VIEWS } from 'lib/planners/composables/useResearchViews';
import { isResearchChainItem } from 'lib/planners/calculations/milestoneChain';

const MODS = { labUpgradeLevel: 0, researchCostMultiplier: 1, puzzleCubeMultiplier: 1 };
// A Monday, well clear of the weekend research sale.
const NOW = Date.UTC(2026, 10, 9, 18) / 1000;
const SALE_DEADLINE = NOW + 6 * 86400;

function candidate(over: Partial<HabSpaceCandidate>): HabSpaceCandidate {
  return {
    target: { kind: 'hab', slotIndex: 0, habId: 1, fromHabId: 0 },
    addedCapacity: 100,
    price: 100,
    waitSeconds: 0,
    duringSale: false,
    spacePerCost: 1,
    ...over,
  };
}

describe('hab space chain', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    setActivePinia(createPinia());
    useInitialStateStore().setSoulEggs(1e21);
  });

  function snapshotWith(over: {
    population: number;
    bankValue?: number;
    habIds?: (number | null)[];
    researchLevels?: Record<string, number>;
  }) {
    const state = { ...createBaseEngineState(null), ...over };
    return { state, snapshot: computeSnapshot(state, getSimulationContext(), { skipEpochConversion: true }) };
  }

  test('the view only shows in the enlightenment planner', () => {
    expect(VIEWS.some(v => v.id === 'hab_space')).toBe(true);
  });

  test('habs fill at the offline hatchery rate', () => {
    const { snapshot } = snapshotWith({ population: 0 });
    const filling = { ...snapshot, population: 100, habCapacity: 1000, offlineIHR: 60 };
    expect(secondsUntilHabsFull(filling)).toBe(900);
    expect(secondsUntilHabsFull({ ...filling, population: 1000 })).toBe(0);
    expect(secondsUntilHabsFull({ ...filling, offlineIHR: 0 })).toBe(Infinity);
  });

  test('the target is the most space per purchase that lands before the habs fill', () => {
    const best = candidate({ spacePerCost: 5, waitSeconds: 2000 });
    const inTime = candidate({ spacePerCost: 3, waitSeconds: 500 });
    const worse = candidate({ spacePerCost: 1, waitSeconds: 10 });
    expect(pickHabSpaceTarget([best, inTime, worse], 1000)).toEqual({ candidate: inTime, beatsFull: true });
    expect(pickHabSpaceTarget([best, inTime, worse], 5000)).toEqual({ candidate: best, beatsFull: true });
    // Nothing lands in time: the habs fill regardless, so go for the best overall.
    expect(pickHabSpaceTarget([best, inTime], 100)).toEqual({ candidate: best, beatsFull: false });
    expect(pickHabSpaceTarget([], 100)).toBeNull();
  });

  test('a much bigger purchase affordable within a minute beats a tiny efficient one', () => {
    const coop = candidate({ addedCapacity: 800, price: 28, spacePerCost: 800 / 28, waitSeconds: 0 });
    const universe = candidate({ addedCapacity: 3e9, price: 1e15, spacePerCost: 3e9 / 1e15, waitSeconds: 0.5 });
    const tooSlow = candidate({ addedCapacity: 6e9, price: 1e18, spacePerCost: 6e9 / 1e18, waitSeconds: 61 });
    expect(pickHabSpaceTarget([coop, universe, tooSlow], 1000)!.candidate).toBe(universe);
    // Still within a minute of the efficient pick, but not before the habs fill.
    expect(pickHabSpaceTarget([coop, universe], 0.25)!.candidate).toBe(coop);
  });

  test('candidates are hab upgrades and hab capacity research, never downgrades', () => {
    // 50 tier-1 purchases unlock tier 2, where Hen House Remodel is.
    const { state, snapshot } = snapshotWith({
      population: 10,
      habIds: [3, null, null, null],
      researchLevels: { comfy_nests: 50 },
    });
    const candidates = listHabSpaceCandidates(state, snapshot, getSimulationContext(), MODS, NOW);
    const habs = candidates.filter(c => c.target.kind === 'hab');
    expect(habs.length).toBeGreaterThan(0);
    for (const c of habs) {
      if (c.target.kind !== 'hab') continue;
      expect(c.target.fromHabId === null || c.target.habId > c.target.fromHabId).toBe(true);
      expect(c.addedCapacity).toBeGreaterThan(0);
    }
    expect(candidates.some(c => c.target.kind === 'research')).toBe(true);
  });

  test('earnings research comes first and the hab space still lands before the habs fill', () => {
    useInitialStateStore().setSoulEggs(1e6);
    const { snapshot } = snapshotWith({ population: 50, bankValue: 0, habIds: [2, 2, null, null] });
    const chain = computeHabSpaceChain(snapshot, getSimulationContext(), MODS, NOW, SALE_DEADLINE);

    expect(chain.habsFullAtStart).toBe(false);
    expect(chain.target).not.toBeNull();
    expect(chain.items.length).toBeGreaterThan(0);
    for (const item of chain.items) {
      if (isResearchChainItem(item)) expect(HAB_CAPACITY_RESEARCH_IDS.has(item.research.id)).toBe(false);
      else expect(item.purchase.kind).not.toBe('hab');
    }
    expect(chain.beatsFull).toBe(true);
    expect(chain.totalSeconds).toBeLessThanOrEqual(chain.fullAtSeconds);
    expect(chain.capacityAfter).toBeGreaterThan(chain.capacityBefore);
    expect(chain.earningsAfter).toBeGreaterThan(chain.earningsBefore);
  });

  test('before the habs fill, earnings purchases affordable in time are bought, then the hab space', () => {
    useInitialStateStore().setSoulEggs(1e12);
    const researchLevels = { comfy_nests: 50, nutritional_sup: 40, padded_packaging: 30, leafsprings: 10 };
    const habIds = [4, 4, 4, 4];
    const capacity = snapshotWith({ population: 0, habIds, researchLevels }).snapshot.habCapacity;
    const { snapshot } = snapshotWith({ population: capacity * 0.98, bankValue: 0, habIds, researchLevels });
    const chain = computeHabSpaceChain(snapshot, getSimulationContext(), MODS, NOW, SALE_DEADLINE);

    expect(chain.items.length).toBeGreaterThan(0);
    expect(chain.beatsFull).toBe(true);
    // Every earnings purchase, and then the hab space, lands before the habs fill.
    for (const item of chain.items) expect(item.buyToHereSeconds).toBeLessThanOrEqual(chain.fullAtSeconds);
    expect(chain.totalSeconds).toBeLessThanOrEqual(chain.fullAtSeconds);
  });

  test('with full habs and no cash, earnings research gets the hab space sooner', () => {
    useInitialStateStore().setSoulEggs(1e6);
    const habIds = [4, 4, 4, 4];
    const capacity = snapshotWith({ population: 0, habIds }).snapshot.habCapacity;
    const { state, snapshot: full } = snapshotWith({ population: capacity, bankValue: 0, habIds });
    const context = getSimulationContext();
    const chain = computeHabSpaceChain(full, context, MODS, NOW, SALE_DEADLINE);

    expect(chain.habsFullAtStart).toBe(true);
    expect(chain.beatsFull).toBe(false);
    expect(chain.target).not.toBeNull();
    expect(chain.items.length).toBeGreaterThan(0);
    const direct = pickHabSpaceTarget(listHabSpaceCandidates(state, full, context, MODS, NOW), 0)!;
    expect(chain.totalSeconds).toBeLessThan(direct.candidate.waitSeconds);
  });
});
