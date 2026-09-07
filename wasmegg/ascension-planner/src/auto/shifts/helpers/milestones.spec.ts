import { describe, expect, test } from 'vitest';
import { modifiersFromColleggtibleTiers } from 'lib/collegtibles';
import type { EngineState, SimulationContext } from '../../types';
import { createMilestoneShiftHelpers } from './milestones';
import { getResearchByTier } from '@/calculations/commonResearch';

function fakeState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    currentEgg: 'curiosity',
    shiftCount: 0,
    te: 0,
    soulEggs: 0,
    bankValue: 0,
    habIds: [0, null, null, null],
    vehicles: [{ vehicleId: 0, trainLength: 1 }],
    researchLevels: {},
    siloCount: 2,
    tankLevel: 0,
    artifactLoadout: [],
    activeArtifactSet: null,
    artifactSets: { earnings: null, elr: null },
    fuelTankAmounts: {} as EngineState['fuelTankAmounts'],
    eggsDelivered: {} as EngineState['eggsDelivered'],
    teEarned: {} as EngineState['teEarned'],
    population: 1e18,
    lastStepTime: 0,
    activeSales: { research: false, hab: false, vehicle: false },
    earningsBoost: { active: false, multiplier: 1 },
    ...overrides,
  };
}

function fakeContext(overrides: Partial<SimulationContext> = {}): SimulationContext {
  return {
    epicResearchLevels: {},
    colleggtibleModifiers: modifiersFromColleggtibleTiers({}),
    ascensionStartTime: 0,
    planStartOffset: 0,
    assumeDoubleEarnings: false,
    deferForEarningsMode: false,
    ...overrides,
  };
}

describe('createMilestoneShiftHelpers previewPurchase', () => {
  // Any tier-1 research is unlocked from a fresh state (TIER_UNLOCK_THRESHOLDS[0] === 0).
  const tier1Research = getResearchByTier().get(1)![0];

  test('matches the wait buyResearch actually takes for the same purchase', () => {
    const anchor = Date.UTC(2024, 0, 1, 0, 0, 0) / 1000;
    const state = fakeState();
    const context = fakeContext({ ascensionStartTime: anchor });
    const helpers = createMilestoneShiftHelpers(state, context);

    const preview = helpers.previewPurchase(tier1Research.id);
    expect(preview).not.toBeNull();

    const elapsedBefore = helpers.getElapsedSeconds();
    const bought = helpers.buyResearch(tier1Research.id, Infinity);
    expect(bought).toBe(true);
    const elapsedAfter = helpers.getElapsedSeconds();

    expect(elapsedAfter - elapsedBefore).toBeCloseTo(preview!.waitSeconds, 6);
  });

  test('returns null once the research is already at max level', () => {
    const anchor = Date.UTC(2024, 0, 1, 0, 0, 0) / 1000;
    const state = fakeState({ researchLevels: { [tier1Research.id]: tier1Research.levels } });
    const context = fakeContext({ ascensionStartTime: anchor });
    const helpers = createMilestoneShiftHelpers(state, context);

    expect(helpers.previewPurchase(tier1Research.id)).toBeNull();
  });
});
