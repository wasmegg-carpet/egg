import { describe, expect, test } from 'vitest';
import { modifiersFromColleggtibleTiers } from 'lib/collegtibles';
import type { EngineState, SimulationContext } from '../../types';
import { advanceTimeWithBoundaries } from './advanceTime';
import { getNextEarningsBoostStart, getNextSaleStart, isResearchSaleActive } from '@/lib/events';

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

describe('advanceTimeWithBoundaries defer for earnings mode', () => {
  // Anchor comfortably before the next Earnings Boost start (Monday 9am PT) so a ~2-day advance
  // is guaranteed to cross it.
  const anchor = Date.UTC(2024, 0, 1, 0, 0, 0) / 1000; // a Monday, well clear of any boost window
  const boostStart = getNextEarningsBoostStart(anchor);
  const totalSeconds = boostStart - anchor + 3600; // land an hour into the boost

  test('inserts a modify_bank credit right before toggle_earnings_boost when defer for earnings mode is on', () => {
    const state = fakeState({ siloCount: 2, lastStepTime: 0 });
    const context = fakeContext({ ascensionStartTime: anchor, deferForEarningsMode: true });

    const actions: any[] = [];
    advanceTimeWithBoundaries(state, actions, 0, context, anchor, totalSeconds);

    const boostOnIdx = actions.findIndex(a => a.type === 'toggle_earnings_boost' && a.payload.active === true);
    expect(boostOnIdx).toBeGreaterThan(0);
    expect(actions[boostOnIdx - 1].type).toBe('modify_bank');
    expect(actions[boostOnIdx - 1].payload.delta).toBeGreaterThan(0);
    expect(actions[boostOnIdx - 1].bankDelta).toBeGreaterThan(0);
  });

  test('does NOT insert a modify_bank credit when defer for earnings mode is off', () => {
    const state = fakeState({ siloCount: 2, lastStepTime: 0 });
    const context = fakeContext({ ascensionStartTime: anchor, deferForEarningsMode: false });

    const actions: any[] = [];
    advanceTimeWithBoundaries(state, actions, 0, context, anchor, totalSeconds);

    expect(actions.some(a => a.type === 'modify_bank')).toBe(false);
    expect(actions.some(a => a.type === 'toggle_earnings_boost' && a.payload.active === true)).toBe(true);
  });
});

describe('advanceTimeWithBoundaries boundary-landing precision', () => {
  // Real exports have shown a step landing on a sale boundary via one arithmetic path (the
  // caller's own `baseAbsTime`, threaded independently of `state.lastStepTime`) while a LATER,
  // freshly re-derived absolute time — `context.ascensionStartTime + (lastStepTime - offset)`, what
  // every other consumer (a fresh `createMilestoneShiftHelpers` call, an export, a tooltip) actually
  // uses — lands a sub-microsecond short of it. Confirmed in the wild: a "Buy Until Sale Ends"
  // batch's first several purchases priced at full rate despite the sale having already toggled on,
  // because the fresh helper re-deriving `baseAbsTime` from `lastStepTime` landed on the wrong side.
  //
  // Simulated here by deliberately drifting `baseAbsTime` a millisecond away from what
  // `ascensionStartTime + (lastStepTime - offset)` would derive for the SAME state — the exact
  // shape of the real-world mismatch, just exaggerated from sub-microsecond to millisecond so the
  // test doesn't hinge on chasing individual ULPs.
  const anchor = Date.UTC(2024, 0, 1, 0, 0, 0) / 1000;
  const saleStart = getNextSaleStart(anchor);
  const driftSeconds = 0.001;

  test('lastStepTime reconstructs the exact sale boundary even when baseAbsTime has drifted from it', () => {
    const context = fakeContext({ ascensionStartTime: anchor, planStartOffset: 0 });
    const priorLastStepTime = 100;
    // baseAbsTime disagrees with `ascensionStartTime + (priorLastStepTime - offset)` by `driftSeconds`
    // — simulating a `baseAbsTime`/`elapsedSeconds` accumulator that's drifted from the state's own
    // canonical `lastStepTime`, exactly like the real bug.
    const driftedBaseAbsTime = anchor + priorLastStepTime + driftSeconds;
    const state = fakeState({ lastStepTime: priorLastStepTime });
    const totalSeconds = saleStart - driftedBaseAbsTime;

    const actions: any[] = [];
    const result = advanceTimeWithBoundaries(state, actions, 0, context, driftedBaseAbsTime, totalSeconds);

    const reconstructedAbsTime =
      context.ascensionStartTime + ((result.currentState.lastStepTime || 0) - context.planStartOffset);

    // Reconstructed via the CANONICAL formula (what a fresh helper/export/tooltip would use), not
    // just this function's own internal reference frame — must land within a tiny fraction of the
    // injected millisecond-scale drift, not merely "closer than before".
    expect(Math.abs(reconstructedAbsTime - saleStart)).toBeLessThan(1e-6);
    expect(isResearchSaleActive(reconstructedAbsTime)).toBe(true);

    const toggleIdx = actions.findIndex(a => a.type === 'toggle_sale' && a.payload.active === true);
    expect(toggleIdx).toBeGreaterThanOrEqual(0);
  });
});
