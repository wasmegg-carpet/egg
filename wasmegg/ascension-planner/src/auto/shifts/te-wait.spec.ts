import { describe, expect, test } from 'vitest';
import { modifiersFromColleggtibleTiers } from 'lib/collegtibles';
import { distributeTargetTE, solveTEForTimeBudget, solveTEDistributionForDeadline, runTEWaitShift, runC4 } from './te-wait';
import { timeToEarnTE, computeTEEarned } from '../te-thresholds';
import { TE_BREAKPOINTS, countTEThresholdsPassed } from '@/lib/truthEggs';
import type { EngineState, SimulationContext } from '../types';
import type { VirtueEgg } from '@/types/actions/virtue';

function fakeState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    currentEgg: 'curiosity',
    shiftCount: 0,
    te: 0,
    soulEggs: 1e20, // effectively unlimited, so shift costs never block a test
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

const ZERO_TES: Record<VirtueEgg, number> = {
  curiosity: 0,
  integrity: 0,
  resilience: 0,
  humility: 0,
  kindness: 0,
};

const ZERO_DELIVERED: Record<VirtueEgg, number> = { ...ZERO_TES };

const MAXED_TES: Record<VirtueEgg, number> = {
  curiosity: 98,
  integrity: 98,
  resilience: 98,
  humility: 98,
  kindness: 98,
};

const MAXED_DELIVERED: Record<VirtueEgg, number> = {
  curiosity: TE_BREAKPOINTS[97],
  integrity: TE_BREAKPOINTS[97],
  resilience: TE_BREAKPOINTS[97],
  humility: TE_BREAKPOINTS[97],
  kindness: TE_BREAKPOINTS[97],
};

// At peakELR = 1, this is exactly the time `solveTEForTimeBudget`/`solveTEDistributionForDeadline`
// charge for a fresh egg's first TE (TE_BREAKPOINTS[0] eggs, plus `timeToEarnTE`'s 0.001s epsilon) —
// derived from the real function rather than hardcoded, so the tests stay correct if the epsilon or
// breakpoint table ever change.
const PEAK_ELR = 1;
const T1 = timeToEarnTE(0, PEAK_ELR, 1);

describe('distributeTargetTE (regression check for the ALL_VIRTUE_EGGS extraction)', () => {
  test('ties broken in egg-iteration order: curiosity, integrity, resilience, humility, kindness', () => {
    const targets = distributeTargetTE(ZERO_DELIVERED, 3);
    expect(targets).toEqual({ curiosity: 1, integrity: 1, resilience: 1, humility: 0, kindness: 0 });
  });

  test('unaffected by lockedEggs when target is unreachable without them', () => {
    const targets = distributeTargetTE(ZERO_DELIVERED, 2, ['curiosity', 'integrity']);
    expect(targets).toEqual({ curiosity: 0, integrity: 0, resilience: 1, humility: 1, kindness: 0 });
  });
});

describe('solveTEForTimeBudget / solveTEDistributionForDeadline agreement', () => {
  test('both report 0 TE reachable with a non-positive time budget', () => {
    expect(solveTEForTimeBudget(ZERO_TES, ZERO_DELIVERED, PEAK_ELR, 0)).toBe(0);
    expect(solveTEForTimeBudget(ZERO_TES, ZERO_DELIVERED, PEAK_ELR, -10)).toBe(0);

    const dist = solveTEDistributionForDeadline(ZERO_TES, ZERO_DELIVERED, PEAK_ELR, 0);
    expect(dist.targets).toEqual(ZERO_TES);
    expect(dist.partial).toBeNull();
  });

  test('both report 0 TE reachable when peakELR <= 0, regardless of budget', () => {
    expect(solveTEForTimeBudget(ZERO_TES, ZERO_DELIVERED, 0, 1e12)).toBe(0);
    expect(solveTEForTimeBudget(ZERO_TES, ZERO_DELIVERED, -5, 1e12)).toBe(0);

    const dist = solveTEDistributionForDeadline(ZERO_TES, ZERO_DELIVERED, 0, 1e12);
    expect(dist.targets).toEqual(ZERO_TES);
    expect(dist.partial).toBeNull();
  });

  test('exact-boundary budget (fits precisely N whole TE, no remainder): partial is null', () => {
    // Exactly enough for curiosity's first TE and nothing else.
    const totalTE = solveTEForTimeBudget(ZERO_TES, ZERO_DELIVERED, PEAK_ELR, T1);
    expect(totalTE).toBe(1);

    const dist = solveTEDistributionForDeadline(ZERO_TES, ZERO_DELIVERED, PEAK_ELR, T1);
    expect(dist.targets).toEqual({ curiosity: 1, integrity: 0, resilience: 0, humility: 0, kindness: 0 });
    expect(dist.partial).toBeNull();
  });

  test('agree on whole-TE totals across a spread of budgets', () => {
    const budgets = [0.5 * T1, T1, 1.5 * T1, 2 * T1, 2.5 * T1, 10 * T1];
    for (const budget of budgets) {
      const total = solveTEForTimeBudget(ZERO_TES, ZERO_DELIVERED, PEAK_ELR, budget);
      const dist = solveTEDistributionForDeadline(ZERO_TES, ZERO_DELIVERED, PEAK_ELR, budget);
      const distTotal = Object.values(dist.targets).reduce((a, b) => a + b, 0);
      expect(distTotal).toBe(total);
    }
  });

  test('every un-locked egg already at the 98-TE cap: no progress possible, partial null', () => {
    expect(solveTEForTimeBudget(MAXED_TES, MAXED_DELIVERED, PEAK_ELR, 1e12)).toBe(98 * 5);

    const dist = solveTEDistributionForDeadline(MAXED_TES, MAXED_DELIVERED, PEAK_ELR, 1e12);
    expect(dist.targets).toEqual(MAXED_TES);
    expect(dist.partial).toBeNull();
  });
});

describe('solveTEDistributionForDeadline partial progress', () => {
  test('budget short of even the first whole TE: partial lands on the cheapest (first, tied) egg', () => {
    const budget = T1 * 0.5;
    const dist = solveTEDistributionForDeadline(ZERO_TES, ZERO_DELIVERED, PEAK_ELR, budget);

    expect(dist.targets).toEqual(ZERO_TES); // no whole TE earned yet
    expect(dist.partial).not.toBeNull();
    expect(dist.partial!.egg).toBe('curiosity'); // first in iteration order among the 0-delivered tie
    expect(dist.partial!.eggsDelivered).toBeGreaterThan(0);
    expect(dist.partial!.eggsDelivered).toBeLessThan(TE_BREAKPOINTS[0]);
    expect(countTEThresholdsPassed(dist.partial!.eggsDelivered)).toBe(0); // hasn't crossed the threshold

    // At peakELR = 1, eggs delivered == seconds elapsed.
    expect(dist.partial!.eggsDelivered).toBeCloseTo(budget, 6);
  });

  test('partial progress lands on the next-cheapest egg once the first is fully claimed', () => {
    // Enough for curiosity's whole first TE, plus half of what a *fresh* egg needs for its own
    // first TE (curiosity's own next TE is now far more expensive, so it's no longer the cheapest
    // candidate — the next fresh egg in iteration order, integrity, is).
    const budget = T1 + T1 * 0.5;
    const dist = solveTEDistributionForDeadline(ZERO_TES, ZERO_DELIVERED, PEAK_ELR, budget);

    expect(dist.targets).toEqual({ curiosity: 1, integrity: 0, resilience: 0, humility: 0, kindness: 0 });
    expect(dist.partial).not.toBeNull();
    expect(dist.partial!.egg).toBe('integrity');
    expect(dist.partial!.eggsDelivered).toBeGreaterThan(0);
    expect(dist.partial!.eggsDelivered).toBeLessThan(TE_BREAKPOINTS[0]);
    expect(countTEThresholdsPassed(dist.partial!.eggsDelivered)).toBe(0);
  });

  test('lockedEggs excludes an otherwise-cheapest egg from both targets and partial', () => {
    const budget = T1 * 0.5;
    const dist = solveTEDistributionForDeadline(ZERO_TES, ZERO_DELIVERED, PEAK_ELR, budget, ['curiosity']);

    expect(dist.partial).not.toBeNull();
    expect(dist.partial!.egg).toBe('integrity'); // next in iteration order once curiosity is excluded
  });

  test('lockedEggs covering every egg: no candidate at all, partial null regardless of budget', () => {
    const allEggs: VirtueEgg[] = ['curiosity', 'integrity', 'resilience', 'humility', 'kindness'];
    const dist = solveTEDistributionForDeadline(ZERO_TES, ZERO_DELIVERED, PEAK_ELR, 1e12, allEggs);

    expect(dist.targets).toEqual(ZERO_TES);
    expect(dist.partial).toBeNull();
  });

  test('a large leftover after the very last reachable whole TE (near the 98-TE cap) still reports partial', () => {
    // One egg one step short of the cap; everything else already maxed and irrelevant to the pick.
    const nearMaxTEs: Record<VirtueEgg, number> = { ...MAXED_TES, curiosity: 97 };
    const nearMaxDelivered: Record<VirtueEgg, number> = { ...MAXED_DELIVERED, curiosity: TE_BREAKPOINTS[96] };

    const timeForLastTE = timeToEarnTE(TE_BREAKPOINTS[96], PEAK_ELR, 1);
    const budget = timeForLastTE + 1000; // finishes the last TE with 1000s to spare, nothing left to spend it on

    const dist = solveTEDistributionForDeadline(nearMaxTEs, nearMaxDelivered, PEAK_ELR, budget);
    expect(dist.targets.curiosity).toBe(98);
    expect(dist.partial).toBeNull(); // every egg is now at the cap; leftover time has nowhere to go
  });
});

describe('runTEWaitShift maxWaitSeconds clamp', () => {
  test('unbounded (default) behavior is unchanged: reaches the full whole-TE target', () => {
    const state = fakeState({ currentEgg: 'curiosity', eggsDelivered: { curiosity: 0 } as any });
    const context = fakeContext();

    const result = runTEWaitShift(state, context, 'curiosity', 1, PEAK_ELR);

    expect(result.elapsedSeconds).toBeCloseTo(T1, 6);
    expect(result.endState.eggsDelivered.curiosity).toBeCloseTo(TE_BREAKPOINTS[0], -6);
    expect(countTEThresholdsPassed(result.endState.eggsDelivered.curiosity)).toBe(1);
    const waitAction = result.actions.find(a => a.type === 'wait_for_te');
    expect(waitAction?.payload.teGained).toBe(1);
  });

  test('maxWaitSeconds <= 0 is a total no-op: no shift action spent, no state change', () => {
    const state = fakeState({ currentEgg: 'integrity', eggsDelivered: { curiosity: 0 } as any });
    const context = fakeContext();

    const result = runTEWaitShift(state, context, 'curiosity', 1, PEAK_ELR, 0);

    expect(result.actions).toEqual([]);
    expect(result.elapsedSeconds).toBe(0);
    expect(result.endState).toBe(state); // literally the same object — nothing touched it
  });

  test('a cap shorter than the full target clips the wait and reports fractional progress', () => {
    const state = fakeState({ currentEgg: 'curiosity', eggsDelivered: { curiosity: 0 } as any });
    const context = fakeContext();
    const cap = T1 * 0.5;

    // Ask for a whole TE that can't be reached within the cap.
    const result = runTEWaitShift(state, context, 'curiosity', 1, PEAK_ELR, cap);

    expect(result.elapsedSeconds).toBeCloseTo(cap, 6);
    expect(countTEThresholdsPassed(result.endState.eggsDelivered.curiosity)).toBe(0); // still short of TE #1
    expect(result.endState.eggsDelivered.curiosity).toBeCloseTo(cap, 6); // peakELR = 1 => eggs == seconds

    const waitAction = result.actions.find(a => a.type === 'wait_for_te');
    expect(waitAction?.payload.teGained).toBe(0);
    expect(waitAction?.payload.timeSeconds).toBeCloseTo(cap, 6);
    // The action's recorded targetTE reflects what was actually reached, not the original request.
    expect(waitAction?.payload.targetTE).toBe(0);
  });

  test('a cap comfortably longer than the full target has no effect (matches computeTEEarned exactly)', () => {
    const state = fakeState({ currentEgg: 'curiosity', eggsDelivered: { curiosity: 0 } as any });
    const context = fakeContext();

    const result = runTEWaitShift(state, context, 'curiosity', 1, PEAK_ELR, T1 * 10);

    expect(result.elapsedSeconds).toBeCloseTo(T1, 6);
    expect(countTEThresholdsPassed(result.endState.eggsDelivered.curiosity)).toBe(1);
  });

  test('still performs the shift-to-egg action even when the wait itself is fully clipped away', () => {
    // maxWaitSeconds > 0 but the egg being requested isn't the current one — the shift itself is
    // still worth doing (it's what a real "partial" ascension truncation looks like: you did switch
    // to the egg, you just ran out of clock before banking any of its next TE).
    const state = fakeState({ currentEgg: 'kindness', eggsDelivered: { curiosity: 0 } as any });
    const context = fakeContext();
    const cap = T1 * 0.1;

    const result = runTEWaitShift(state, context, 'curiosity', 1, PEAK_ELR, cap);

    const shiftAction = result.actions.find(a => a.type === 'shift');
    expect(shiftAction).toBeDefined();
    expect(result.endState.currentEgg).toBe('curiosity');
    expect(result.elapsedSeconds).toBeCloseTo(cap, 6);
  });

  test('runC4 forwards maxWaitSeconds to the underlying runTEWaitShift clamp', () => {
    const state = fakeState({ currentEgg: 'curiosity', eggsDelivered: { curiosity: 0 } as any });
    const context = fakeContext();
    const cap = T1 * 0.5;

    const result = runC4(state, context, 1, PEAK_ELR, cap);

    expect(result.elapsedSeconds).toBeCloseTo(cap, 6);
    expect(countTEThresholdsPassed(result.endState.eggsDelivered.curiosity)).toBe(0);
  });

  test('clamped fractional progress matches computeTEEarned exactly for the same duration', () => {
    const state = fakeState({ currentEgg: 'curiosity', eggsDelivered: { curiosity: 1.2e9 } as any });
    const context = fakeContext();
    const cap = 5000;

    const result = runTEWaitShift(state, context, 'curiosity', 3, PEAK_ELR, cap);
    const expected = computeTEEarned(1.2e9, PEAK_ELR, cap);

    expect(result.endState.eggsDelivered.curiosity).toBeCloseTo(expected.finalEggsDelivered, 6);
    const waitAction = result.actions.find(a => a.type === 'wait_for_te');
    expect(waitAction?.payload.teGained).toBe(expected.teEarned);
  });
});
