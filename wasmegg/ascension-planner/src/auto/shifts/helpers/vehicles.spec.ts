import { describe, expect, test } from 'vitest';
import { modifiersFromColleggtibleTiers } from 'lib/collegtibles';
import { runMaxVehiclesPlan, runVehiclesForTimeLimit } from './vehicles';
import type { EngineState, SimulationContext, ShiftResult } from '../../types';

function fakeState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    currentEgg: 'kindness',
    shiftCount: 0,
    te: 0,
    soulEggs: 1e20,
    bankValue: 0,
    habIds: [0, null, null, null],
    vehicles: [{ vehicleId: null, trainLength: 1 }],
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

function fakeContext(bustUnions: number): SimulationContext {
  return {
    epicResearchLevels: { bust_unions: bustUnions },
    colleggtibleModifiers: modifiersFromColleggtibleTiers({}),
    ascensionStartTime: 0,
    planStartOffset: 0,
    assumeDoubleEarnings: false,
    deferForEarningsMode: false,
  };
}

function purchaseCosts(result: ShiftResult): number[] {
  return result.actions.filter(a => a.type === 'buy_vehicle' || a.type === 'buy_train_car').map(a => a.cost);
}

// This fixture has no earnings, so the bank is the only way to pay for anything: with an empty bank
// the planners can only take the free first vehicle, whose cost of 0 hides any discount.
const FUNDED = { bankValue: 1e40 };

function expectHalved(discounted: number[], undiscounted: number[]) {
  const paid = undiscounted.filter(cost => cost > 0);
  expect(paid.length).toBeGreaterThan(1);
  expect(discounted).toHaveLength(undiscounted.length);
  discounted.forEach((cost, i) => {
    if (undiscounted[i] > 0) expect(cost / undiscounted[i]).toBeCloseTo(0.5, 9);
  });
}

describe('vehicle planners apply Bust Unions', () => {
  test('runMaxVehiclesPlan: max Bust Unions halves every purchase', () => {
    const undiscounted = purchaseCosts(runMaxVehiclesPlan(fakeState(FUNDED), fakeContext(0), Infinity));
    const discounted = purchaseCosts(runMaxVehiclesPlan(fakeState(FUNDED), fakeContext(10), Infinity));

    expectHalved(discounted, undiscounted);
  });

  test('runVehiclesForTimeLimit: max Bust Unions halves every purchase', () => {
    const undiscounted = purchaseCosts(runVehiclesForTimeLimit(fakeState(FUNDED), fakeContext(0), Infinity));
    const discounted = purchaseCosts(runVehiclesForTimeLimit(fakeState(FUNDED), fakeContext(10), Infinity));

    expectHalved(discounted, undiscounted);
  });
});
