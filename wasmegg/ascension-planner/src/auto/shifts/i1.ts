import type { EngineState, SimulationContext, ShiftResult } from '../types';
import { applyShiftIfNeeded } from './helpers/actionHelpers';
import { runHabPurchasePlan } from './helpers/habs';
import { CHICKEN_UNIVERSE_ID } from '../../calculations/habPurchasePlan';

export const I1_TIME_LIMIT_SECONDS = 4 * 3600;

/**
 * I1 Shift Strategy:
 * 1. Shift to Integrity.
 * 2. Buy hab upgrades for up to `timeLimit` seconds (default 4 hours). `runHabPurchasePlan` stops
 *    early once every slot holds a Chicken Universe, and never starts a purchase whose wait would
 *    run past `timeLimit`, so the shift ends at its last purchase rather than idling out the
 *    remaining budget. Pass `Infinity` to run until habs are maxed.
 *
 * Low earners can't max habs within the cap; when one C1 -> K1 -> I1 pass doesn't end with
 * `habsMaxed(endState)`, `runC1K1I1Segment` in `ascension.ts` tries two-round openings instead.
 *
 * `runHabPurchasePlan` re-evaluates the best next purchase every step, across all 4 slots, rather
 * than a single upfront decision — unverified whether that changes I1's simulated output; worth a
 * before/after check if I1's output looks off.
 */
export function runI1(
  startState: EngineState,
  context: SimulationContext,
  timeLimit: number = I1_TIME_LIMIT_SECONDS
): ShiftResult {
  const { state, actions: shiftActions } = applyShiftIfNeeded(startState, context, 'integrity');
  const plan = runHabPurchasePlan(state, context, timeLimit);

  return {
    actions: [...shiftActions, ...plan.actions],
    elapsedSeconds: plan.elapsedSeconds,
    endState: plan.endState,
  };
}

export function habsMaxed(state: EngineState): boolean {
  return state.habIds.every(id => id === CHICKEN_UNIVERSE_ID);
}
