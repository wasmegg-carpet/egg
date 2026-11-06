import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ei } from 'lib';
import { getDiscountedHabPrice, getHabById } from '@/lib/habs';
import { getResearchById, getDiscountedResearchPrice } from '@/calculations/commonResearch';
import { calculateEarningBonus } from '@/calculations/earnings';
import { calculateEggValue, ENLIGHTENMENT_EGG_VALUE } from '@/calculations/eggValue';
import { calculateIHR } from 'lib/planners/calculations/internalHatcheryRate';
import { computeGoalStatuses, nahPopulationTarget, secondsToReachPopulation } from '@/calculations/goals';
import { createBaseEngineState, getSimulationContext } from './adapter';
import { computeSnapshot } from './compute';
import { refreshActionPayload } from './apply/duration';
import { applyAction } from './apply/actions';
import { useInitialStateStore } from '@/stores/initialState';
import { useActionsStore } from '@/stores/actions';
import { createSimAction, createEmptySnapshot, type Action } from '@/types';
import { parseEnlightenmentFarm } from '@/lib/backupFarm';
import { getArtifactLoadoutFromBackup } from '@/lib/artifacts';
import { allPossibleTiers } from 'lib/artifacts/data';
import { PROFILE } from '@/lib/profile';


describe('earnings on an enlightenment farm', () => {
  const bonus = (over: Partial<Parameters<typeof calculateEarningBonus>[0]>) =>
    calculateEarningBonus({
      soulEggs: 1e21,
      prophecyEggs: 200,
      te: 100,
      soulFoodLevel: 140,
      prophecyBonusLevel: 5,
      artifactSoulEggBonus: 0,
      artifactProphecyEggBonus: 0,
      ...over,
    });

  test('the earning bonus is the game formula', () => {
    expect(bonus({})).toBeCloseTo(1e21 * (0.1 + 1.4) * 1.1 ** 200 * 1.01 ** 100, -30);
  });

  test('a Truth Egg is worth 1%, Soul Eggs count, and artifacts add to the per-egg bonuses', () => {
    expect(bonus({ te: 101 }) / bonus({ te: 100 })).toBeCloseTo(1.01, 10);
    expect(bonus({ soulEggs: 2e21 }) / bonus({})).toBeCloseTo(2, 10);
    expect(bonus({ artifactSoulEggBonus: 1.5 }) / bonus({})).toBeCloseTo(3 / 1.5, 10);
    expect(bonus({ prophecyEggs: 201, artifactProphecyEggBonus: 0.01 })).toBeGreaterThan(bonus({ prophecyEggs: 201 }));
  });

  test('a Truth Egg is worth 1% of internal hatchery rate too', () => {
    const ihr = (te: number) =>
      calculateIHR({
        te,
        teBase: PROFILE.ihrTruthEggBase,
        researchLevels: { internal_hatchery1: 10 },
        epicResearchLevels: { epicInternalIncubators: 20, internalHatcheryCalm: 20 },
        ihrMultiplier: 1,
        artifactMultiplier: 1,
        artifactEffects: [],
      }).offlineRate;
    expect(ihr(101) / ihr(100)).toBeCloseTo(1.01, 10);
  });

  test('an egg starts at the Enlightenment egg value', () => {
    const value = calculateEggValue({
      baseValue: ENLIGHTENMENT_EGG_VALUE,
      researchLevels: {},
      artifactMultiplier: 1,
      artifactEffects: [],
    });
    expect(value.finalValue).toBe(1e-7);
  });
});

describe('prices on an enlightenment farm', () => {
  test('habs and research charge the regular price', () => {
    const coop = getHabById(0)!;
    const mods = { cheaperContractorsLevel: 0, habCostMultiplier: 1 };
    expect(getDiscountedHabPrice(coop, 1, mods, false)).toBe(29.12);
    const nests = getResearchById('comfy_nests')!;
    expect(getDiscountedResearchPrice(nests, 0, { labUpgradeLevel: 0, researchCostMultiplier: 1, puzzleCubeMultiplier: 1 }, false)).toBe(0.5);
  });
});

describe('a plan on an enlightenment farm', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    setActivePinia(createPinia());
  });

  function startSnapshot(population = 0) {
    const context = getSimulationContext();
    return computeSnapshot({ ...createBaseEngineState(null), population }, context, { skipEpochConversion: true });
  }

  test('more Soul Eggs earn more, with no shift in sight', () => {
    const store = useInitialStateStore();
    store.setSoulEggs(1e20);
    const low = startSnapshot(1000).offlineEarnings;
    store.setSoulEggs(1e21);
    expect(startSnapshot(1000).offlineEarnings / low).toBeCloseTo(10, 5);
  });

  test('waiting for a population takes the hatchery time, stopping at full habs', () => {
    const snapshot = { ...startSnapshot(100), habCapacity: 1000, offlineIHR: 60 };
    const wait = (targetPopulation: number) =>
      refreshActionPayload(
        createSimAction('wait_for_population', {
          targetPopulation,
          currentPopulation: 0,
          ihr: 0,
          reachable: true,
          totalTimeSeconds: 0,
        }) as Action,
        snapshot
      ).payload as import('@/types').WaitForPopulationPayload;
    expect(wait(500).totalTimeSeconds).toBe(400);
    expect(wait(500).reachable).toBe(true);
    expect(wait(5000).totalTimeSeconds).toBe(900);
    expect(wait(5000).reachable).toBe(false);
  });

  test('fuel stored goes in the regular tank', () => {
    const state = createBaseEngineState(null);
    const next = applyAction(state, {
      type: 'store_fuel',
      cost: 0,
      payload: { egg: 'enlightenment', amount: 5, timeSeconds: 1 },
    } as never);
    expect(next.fuelTankAmounts.enlightenment).toBe(5);
    expect(useActionsStore()).toBeTruthy();
  });
});

describe('goals', () => {
  const end = (population: number, lastStepTime: number, offlineIHR = 60, researchLevels = {}) => ({
    ...createEmptySnapshot(),
    population,
    lastStepTime,
    offlineIHR,
    researchLevels,
  });
  const action = (endState: ReturnType<typeof end>, totalTimeSeconds: number) =>
    ({ endState, totalTimeSeconds }) as unknown as Action;

  test('a crossing inside an action lands at its exact time, not the action end', () => {
    const actions = [action(end(100, 100), 100), action(end(1000, 1000), 900)];
    expect(secondsToReachPopulation(actions, end(0, 0), 0, 500)).toBe(500);
  });

  test('time counts from the plan start, and an already passed target takes none', () => {
    const actions = [action(end(1000, 5100), 100)];
    expect(secondsToReachPopulation(actions, end(900, 5000), 5000, 950)).toBe(50);
    expect(secondsToReachPopulation(actions, end(900, 5000), 5000, 900)).toBe(0);
    expect(secondsToReachPopulation(actions, end(900, 5000), 5000, 1001)).toBeNull();
  });

  test('NAH scales with the best hab size colleggtibles', () => {
    expect(nahPopulationTarget(1)).toBe(19_845_000_000);
    expect(nahPopulationTarget(1.05)).toBe(20_837_250_000);
  });

  test('statuses list the trophies, then NAH and ACRE', () => {
    const statuses = computeGoalStatuses([action(end(10e6, 100), 100)], end(0, 0, 6e6), 0);
    expect(statuses.map(s => s.id)).toEqual(['bronze', 'silver', 'gold', 'platinum', 'diamond', 'nah', 'acre']);
    expect(statuses[0].reachedAfterSeconds).toBe(100);
    expect(statuses[1].reachedAfterSeconds).toBeNull();
    expect(statuses[6].reachedAfterSeconds).toBeNull();
  });
});

describe('reading a backup', () => {
  test('finds the enlightenment farm, and only that one', () => {
    const farm = { eggType: ei.Egg.ENLIGHTENMENT, numChickens: 5, habs: [0], vehicles: [0], trainLength: [1] };
    expect(parseEnlightenmentFarm({ farms: [farm] } as never)?.population).toBe(5);
    expect(parseEnlightenmentFarm({ farms: [{ ...farm, eggType: ei.Egg.CURIOSITY }] } as never)).toBeNull();
  });

  test('reads the regular artifact loadout, not the virtue one', () => {
    const tier = allPossibleTiers.find(t => t.family.id === 'demeters-necklace' && t.tier_number === 4)!;
    const spec = { name: tier.afx_id, level: tier.afx_level, rarity: 3 };
    const loadout = getArtifactLoadoutFromBackup({
      artifactsDb: {
        inventoryItems: [{ itemId: 7, artifact: { spec, stones: [] } }],
        activeArtifactSets: [{ slots: [{ occupied: true, itemId: 7 }] }],
        virtueAfxDb: { inventoryItems: [], activeArtifacts: { slots: [] } },
      },
    } as never);
    expect(loadout[0].artifactId).toBe('demeters-necklace-4-3');
  });
});
