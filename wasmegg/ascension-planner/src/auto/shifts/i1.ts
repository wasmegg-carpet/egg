import type { EngineState, SimulationContext, ShiftResult } from '../types';
import { applyShiftAction } from './helpers/actionHelpers';
import { runHabPurchasePlan } from './helpers/habs';

/**
 * I1 Shift Strategy:
 * 1. Shift to Integrity.
 * 2. Buy hab upgrades until all 4 slots hold Chicken Universes — no time cap. `runHabPurchasePlan`
 *    stops naturally once habs are maxed (`simulateHabPurchases` bails out once every slot holds a
 *    Chicken Universe, and is separately bounded by its own iteration cap), so passing an unbounded
 *    time budget here means "run to completion" rather than "run up to N seconds." This makes I1's
 *    duration a deterministic function of its input state, which `runC1K1I1Segment` in
 *    `ascension.ts` relies on to decide shift ordering.
 *
 * `runHabPurchasePlan` re-evaluates the best next purchase every step, across all 4 slots, rather
 * than a single upfront decision — unverified whether that changes I1's simulated output; worth a
 * before/after check if I1's output looks off.
 */
export function runI1(startState: EngineState, context: SimulationContext): ShiftResult {
  const { state, action: shiftAction } = applyShiftAction(startState, context, 'integrity');
  const plan = runHabPurchasePlan(state, context, Infinity);

  return {
    actions: [shiftAction, ...plan.actions],
    elapsedSeconds: plan.elapsedSeconds,
    endState: plan.endState,
  };
}
