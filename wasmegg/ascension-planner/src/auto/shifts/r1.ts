import type { EngineState, SimulationContext, ShiftResult } from '../types';
import { applyShiftIfNeeded } from './helpers/actionHelpers';
import { runSiloBudgetPlan } from './helpers/silos';

/**
 * R1 Shift Strategy:
 * 1. Shift to Resilience.
 * 2. Buy as many silos as possible within 1 hour.
 */
export function runR1(startState: EngineState, context: SimulationContext, timeLimit: number = 3600): ShiftResult {
  const { state, actions: shiftActions } = applyShiftIfNeeded(startState, context, 'resilience');
  const plan = runSiloBudgetPlan(state, context, timeLimit, timeLimit);

  return {
    actions: [...shiftActions, ...plan.actions],
    elapsedSeconds: plan.elapsedSeconds,
    endState: plan.endState,
  };
}
