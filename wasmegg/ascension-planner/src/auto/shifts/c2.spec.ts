import { describe, expect, test } from 'vitest';
import { modifiersFromColleggtibleTiers } from 'lib/collegtibles';
import { runR1LookaheadEarningsBuy } from './c2';
import { runK2 } from './k2';
import { runR1 } from './r1';
import type { EngineState, SimulationContext } from '../types';

function fakeState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    currentEgg: 'curiosity',
    shiftCount: 0,
    te: 0,
    soulEggs: 1e20,
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

function throughR1(state: EngineState, context: SimulationContext) {
  const k2 = runK2(state, context);
  const r1 = runR1(k2.endState, context);
  return { siloCount: r1.endState.siloCount, seconds: k2.elapsedSeconds + r1.elapsedSeconds };
}

describe('runR1LookaheadEarningsBuy', () => {
  test('a zero budget buys nothing and leaves the state untouched', () => {
    const context = fakeContext();
    const state = fakeState();

    const result = runR1LookaheadEarningsBuy(state, context, 0);

    expect(result.actions).toEqual([]);
    expect(result.elapsedSeconds).toBe(0);
    expect(result.endState).toEqual(state);
  });

  // Slow (~8s): this fake farm earns so little that the sweep spends nearly the whole budget on
  // dozens of cheap purchases, re-ranking every round. Real C2 end states sweep far fewer rounds.
  test('the kept stopping point is never worse through R1 than buying nothing', { timeout: 60000 }, () => {
    const context = fakeContext();
    const state = fakeState();
    const baseline = throughR1(state, context);

    const result = runR1LookaheadEarningsBuy(state, context, 14400);
    const after = throughR1(result.endState, context);

    expect(result.elapsedSeconds).toBeLessThanOrEqual(14400);
    expect(after.siloCount).toBeGreaterThanOrEqual(baseline.siloCount);
    if (after.siloCount === baseline.siloCount) {
      expect(result.elapsedSeconds + after.seconds).toBeLessThanOrEqual(baseline.seconds);
    }
  });
});
