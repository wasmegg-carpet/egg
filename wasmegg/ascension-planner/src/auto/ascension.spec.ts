import { describe, expect, test } from 'vitest';
import { modifiersFromColleggtibleTiers } from 'lib/collegtibles';
import { runContinueCurrent } from './ascension';
import { timeToEarnTE } from './te-thresholds';
import type { EngineState, SimulationContext } from './types';

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

const PEAK_ELR = 1;
const T1 = timeToEarnTE(0, PEAK_ELR, 1);

describe('runContinueCurrent: targetTE mode (regression — unaffected by the targetEndTime addition)', () => {
  test('reaches the requested whole-TE total', () => {
    const state = fakeState({ eggsDelivered: {} as any, lastStepTime: 0 });
    const context = fakeContext();

    const { summary } = runContinueCurrent(state, context, 0, PEAK_ELR, 3);

    expect(summary.endTE).toBe(3);
    expect(Object.values(summary.finalTE).reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe('runContinueCurrent: targetEndTime (deadline) mode', () => {
  test('never overruns the deadline', () => {
    const state = fakeState({ eggsDelivered: {} as any, lastStepTime: 0 });
    const context = fakeContext();
    const deadline = T1 * 2.5;

    const { summary } = runContinueCurrent(state, context, 0, PEAK_ELR, undefined, 'asc_continue', deadline);

    expect(summary.endTime).toBeLessThanOrEqual(deadline + 1e-6);
  });

  test('a budget landing mid-egg produces fractional (sub-threshold) progress via the top-up pass', () => {
    const state = fakeState({ eggsDelivered: {} as any, lastStepTime: 0 });
    const context = fakeContext();
    const deadline = T1 * 1.5; // one whole TE, plus half of what a second egg would need

    const { summary } = runContinueCurrent(state, context, 0, PEAK_ELR, undefined, 'asc_continue', deadline);

    expect(summary.endTE).toBe(1); // only one whole TE banked
    expect(summary.endTime).toBeCloseTo(deadline, 6); // but the full deadline's worth of time was spent

    // Exactly one egg (besides the one that got the whole TE) should show real, sub-threshold progress.
    const eggs = ['curiosity', 'integrity', 'resilience', 'humility', 'kindness'] as const;
    const finalTE = summary.finalTE as unknown as Record<string, number>;
    const wholeEggs = eggs.filter(e => finalTE[e] > 0);
    expect(wholeEggs.length).toBe(1);
  });

  test('an exact-boundary budget needs no top-up: lands cleanly on a whole TE', () => {
    const state = fakeState({ eggsDelivered: {} as any, lastStepTime: 0 });
    const context = fakeContext();

    const { summary } = runContinueCurrent(state, context, 0, PEAK_ELR, undefined, 'asc_continue', T1);

    expect(summary.endTE).toBe(1);
    expect(summary.endTime).toBeCloseTo(T1, 6);
  });

  test('targetTE takes priority over targetEndTime when both are supplied', () => {
    const state = fakeState({ eggsDelivered: {} as any, lastStepTime: 0 });
    const context = fakeContext();

    // A deadline far too short for 2 TE, but targetTE should win and ignore it entirely.
    const { summary } = runContinueCurrent(state, context, 0, PEAK_ELR, 2, 'asc_continue', T1 * 0.1);

    expect(summary.endTE).toBe(2);
  });

  test('zero remaining budget after the whole-TE pass: no top-up, no negative time', () => {
    const state = fakeState({ eggsDelivered: {} as any, lastStepTime: 0 });
    const context = fakeContext();

    const { summary } = runContinueCurrent(state, context, 0, PEAK_ELR, undefined, 'asc_continue', 0);

    expect(summary.endTE).toBe(0);
    expect(summary.endTime).toBe(0);
  });
});
