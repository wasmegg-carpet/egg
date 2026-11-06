import type { VirtueEgg } from '@/types';
import { describe, expect, test } from 'vitest';
import { modifiersFromColleggtibleTiers } from 'lib/collegtibles';
import { deriveNextStartState, runAscensionFromC3Variant, runContinueCurrent, runUntilShift } from './ascension';
import { timeToEarnTE } from './te-thresholds';
import { runMaxVehiclesPlan } from './shifts/helpers/vehicles';
import { maxedBaseState, maxedContext } from '@/buildTable/maxedAccount';
import { contextAt, variantsFrom } from '@/buildTable/cell';
import { TE_BREAKPOINTS } from '@/lib/truthEggs';
import type { AscensionSummary, EngineState, SimulationContext } from './types';

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
    const state = fakeState({ eggsDelivered: {} as Record<VirtueEgg, number>, lastStepTime: 0 });
    const context = fakeContext();

    const { summary } = runContinueCurrent(state, context, 0, PEAK_ELR, 3);

    expect(summary.endTE).toBe(3);
    expect(Object.values(summary.finalTE).reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe('runContinueCurrent: targetEndTime (deadline) mode', () => {
  test('never overruns the deadline', () => {
    const state = fakeState({ eggsDelivered: {} as Record<VirtueEgg, number>, lastStepTime: 0 });
    const context = fakeContext();
    const deadline = T1 * 2.5;

    const { summary } = runContinueCurrent(state, context, 0, PEAK_ELR, undefined, 'asc_continue', deadline);

    expect(summary.endTime).toBeLessThanOrEqual(deadline + 1e-6);
  });

  test('a budget landing mid-egg produces fractional (sub-threshold) progress via the top-up pass', () => {
    const state = fakeState({ eggsDelivered: {} as Record<VirtueEgg, number>, lastStepTime: 0 });
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
    const state = fakeState({ eggsDelivered: {} as Record<VirtueEgg, number>, lastStepTime: 0 });
    const context = fakeContext();

    const { summary } = runContinueCurrent(state, context, 0, PEAK_ELR, undefined, 'asc_continue', T1);

    expect(summary.endTE).toBe(1);
    expect(summary.endTime).toBeCloseTo(T1, 6);
  });

  test('targetTE takes priority over targetEndTime when both are supplied', () => {
    const state = fakeState({ eggsDelivered: {} as Record<VirtueEgg, number>, lastStepTime: 0 });
    const context = fakeContext();

    // A deadline far too short for 2 TE, but targetTE should win and ignore it entirely.
    const { summary } = runContinueCurrent(state, context, 0, PEAK_ELR, 2, 'asc_continue', T1 * 0.1);

    expect(summary.endTE).toBe(2);
  });

  test('zero remaining budget after the whole-TE pass: no top-up, no negative time', () => {
    const state = fakeState({ eggsDelivered: {} as Record<VirtueEgg, number>, lastStepTime: 0 });
    const context = fakeContext();

    const { summary } = runContinueCurrent(state, context, 0, PEAK_ELR, undefined, 'asc_continue', 0);

    expect(summary.endTE).toBe(0);
    expect(summary.endTime).toBe(0);
  });
});

describe('runAscension: H1 takes over the build-phase wait when K3 has nothing to buy', () => {
  test('waits on humility in H1, then K3/C4/I2/R2 only — no H2', () => {
    const te = { curiosity: 39, integrity: 40, humility: 39, resilience: 39, kindness: 40 };
    const delivered = Object.fromEntries(Object.entries(te).map(([e, n]) => [e, TE_BREAKPOINTS[n - 1]]));
    const state = deriveNextStartState(
      { finalTE: te, endSoulEggs: 1e30, endShiftCount: 0, eggsDelivered: delivered } as unknown as AscensionSummary,
      maxedBaseState()
    );
    const start = 1_793_368_800; // 2026-10-30 08:00 America/Denver
    const context = contextAt(maxedContext(), start);
    const preC3 = runUntilShift(state, context, 'C3');
    const variant = variantsFrom(preC3, context, 197)[0];
    // Leave C3 with a full fleet, so K3 would have nothing to buy.
    variant.result.endState.vehicles = runMaxVehiclesPlan(variant.result.endState, context, Infinity).endState.vehicles;

    const { actions, summary } = runAscensionFromC3Variant(state, preC3, variant, context, start, 'a', 401);

    const shifts = actions.filter(a => a.type === 'shift');
    const names = shifts.map(a => (a.type === 'shift' ? a.payload.autoShiftName : undefined));
    expect(names.slice(-5)).toEqual(['H1', 'K3', 'C4', 'I2', 'R2']);

    const h1 = shifts.find(a => a.type === 'shift' && a.payload.autoShiftName === 'H1')!;
    const k3 = shifts.find(a => a.type === 'shift' && a.payload.autoShiftName === 'K3')!;
    const h1Actions = actions.slice(actions.indexOf(h1), actions.indexOf(k3));
    expect(h1.type === 'shift' && h1.payload.peakELR).toBeGreaterThan(0);
    expect(h1Actions.some(a => a.type === 'wait_for_te' && a.payload.egg === 'humility')).toBe(true);
    expect(summary.endTE).toBe(401);
    expect(summary.endTime).toBeGreaterThanOrEqual(variant.buildPhaseEnd);
  }, 60000);
});
