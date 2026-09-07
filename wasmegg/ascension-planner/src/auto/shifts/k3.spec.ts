import { describe, expect, test } from 'vitest';
import { modifiersFromColleggtibleTiers } from 'lib/collegtibles';
import { runK3 } from './k3';
import { computeTEEarned, timeToEarnTE } from '../te-thresholds';
import { countTEThresholdsPassed } from '@/lib/truthEggs';
import type { EngineState, SimulationContext } from '../types';

// A fleet already at the base caps (4 slots, all hyperloops, max train length) with empty research
// levels — so `runMaxVehiclesPlan` (K3's step 2) has nothing left to buy and contributes 0 elapsed
// seconds, letting these tests isolate K3's own wait-duration arithmetic (step 4) instead of also
// exercising vehicle-purchase planning.
const MAXED_FLEET = Array.from({ length: 4 }, () => ({ vehicleId: 11, trainLength: 5 }));

function fakeState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    currentEgg: 'curiosity',
    shiftCount: 0,
    te: 0,
    soulEggs: 1e20,
    bankValue: 0,
    habIds: [0, null, null, null],
    vehicles: MAXED_FLEET,
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

describe('runK3 maxWaitSeconds clamp', () => {
  test('unbounded (default): waits exactly to buildPhaseEnd when no TE target is given', () => {
    const state = fakeState({ eggsDelivered: { kindness: 0 } as any });
    const context = fakeContext();

    const result = runK3(state, context, 1000);

    expect(result.elapsedSeconds).toBeCloseTo(1000, 6);
  });

  test('a cap shorter than buildPhaseEnd itself is a caller-invariant violation and DOES truncate the mandatory wait (documented, not a "correct" outcome)', () => {
    // This is here to pin down the documented caveat on `runK3`'s own doc comment: the clamp has no
    // way to distinguish "mandatory buildPhaseEnd wait" from "optional TE-target extension," so a
    // caller that violates the invariant (buildPhaseEnd reachable within maxWaitSeconds) gets a
    // truncated build phase, not an error. Production code never does this — `runC3Variants`
    // filtering guarantees it — but the behavior itself should stay predictable.
    const state = fakeState({ eggsDelivered: { kindness: 0 } as any });
    const context = fakeContext();

    const result = runK3(state, context, 1000, undefined, 400);

    expect(result.elapsedSeconds).toBeCloseTo(400, 6);
  });

  // This fixture's maxed-out fleet/population makes peakELR large enough that even a short
  // buildPhaseEnd can cross a TE threshold on its own (see the "passive TE" describe block below) —
  // so a fixed constant like "1000 seconds" can't safely stand in for "definitely short of TE #1"
  // across environments. Deriving buildPhaseEnd from a real probe run keeps these tests honest about
  // what they're actually asserting instead of assuming a magnitude.
  function probePeakELR(): number {
    const probe = runK3(fakeState({ eggsDelivered: { kindness: 0 } as any }), fakeContext(), 1);
    return probe.actions.find(a => a.type === 'shift')?.payload.peakELR as number;
  }

  test('buildPhaseEnd floor is preserved when maxWaitSeconds comfortably covers it', () => {
    const peakELR = probePeakELR();
    const buildPhaseEnd = timeToEarnTE(0, peakELR, 1) * 0.5; // deliberately short of TE #1

    const state = fakeState({ eggsDelivered: { kindness: 0 } as any });
    const context = fakeContext();
    const result = runK3(state, context, buildPhaseEnd, undefined, buildPhaseEnd * 10);

    expect(result.elapsedSeconds).toBeCloseTo(buildPhaseEnd, 6);
    expect(countTEThresholdsPassed(result.endState.eggsDelivered.kindness)).toBe(0);
  });

  test('a TE-target extension beyond buildPhaseEnd gets clipped by maxWaitSeconds, landing on fractional progress', () => {
    const peakELR = probePeakELR();
    const timeForOneTE = timeToEarnTE(0, peakELR, 1);
    const cap = timeForOneTE * 0.5; // enough to make real progress, not enough to finish TE #1

    const state = fakeState({ eggsDelivered: { kindness: 0 } as any });
    const context = fakeContext();
    // buildPhaseEnd = 1 (negligible) so the mandatory floor never dominates the TE-target extension.
    const result = runK3(state, context, 1, 1, cap);

    expect(result.elapsedSeconds).toBeCloseTo(cap, 6);
    expect(countTEThresholdsPassed(result.endState.eggsDelivered.kindness)).toBe(0); // clipped short of TE #1
    expect(result.endState.eggsDelivered.kindness).toBeGreaterThan(0); // but real fractional progress was made
  });

  test('maxWaitSeconds that fits the TE target exactly matches the unclamped result', () => {
    const state = fakeState({ eggsDelivered: { kindness: 0 } as any });
    const context = fakeContext();

    const unclamped = runK3(fakeState({ eggsDelivered: { kindness: 0 } as any }), context, 10, 1);
    const clamped = runK3(state, context, 10, 1, unclamped.elapsedSeconds + 1);

    expect(clamped.elapsedSeconds).toBeCloseTo(unclamped.elapsedSeconds, 6);
    expect(clamped.endState.eggsDelivered.kindness).toBeCloseTo(unclamped.endState.eggsDelivered.kindness, 6);
  });
});

// Sanity cross-check: whatever `computeTEEarned`/`timeToEarnTE` predict independently should match
// what K3 actually produces once its own peakELR calculation settles — this state's empty research
// levels and single, un-artifacted setup should compute a nonzero peakELR (all base rates), so a
// generous buildPhaseEnd should already be earning some kindness TE passively.
describe('runK3 sanity: passive TE during the mandatory wait is real, not a fixed constant', () => {
  test('a long enough buildPhaseEnd alone (no TE target) can already cross a TE threshold', () => {
    const state = fakeState({ eggsDelivered: { kindness: 0 } as any });
    const context = fakeContext();

    // Run once to discover this setup's own peakELR, then pick a buildPhaseEnd long enough to cross
    // TE #1 purely from the mandatory wait, and confirm that's exactly what happens.
    const probe = runK3(state, context, 1);
    const peakELR = probe.actions.find(a => a.type === 'shift')?.payload.peakELR as number;
    expect(peakELR).toBeGreaterThan(0);

    const timeForOneTE = timeToEarnTE(0, peakELR, 1);
    const result = runK3(fakeState({ eggsDelivered: { kindness: 0 } as any }), context, timeForOneTE + 10);

    expect(countTEThresholdsPassed(result.endState.eggsDelivered.kindness)).toBe(1);
    const expected = computeTEEarned(0, peakELR, timeForOneTE + 10);
    expect(result.endState.eggsDelivered.kindness).toBeCloseTo(expected.finalEggsDelivered, 3);
  });
});
