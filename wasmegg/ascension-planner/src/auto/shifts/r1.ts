import type { EngineState, SimulationContext, ShiftResult } from '../types';
import { applyShiftAction } from './helpers/actionHelpers';
import { runSiloBudgetPlan } from './helpers/silos';

/**
 * R1 Shift Strategy:
 * 1. Shift to Resilience.
 * 2. Buy as many silos as possible within 1 hour.
 */
export function runR1(startState: EngineState, context: SimulationContext, timeLimit: number = 3600): ShiftResult {
  const { state, action: shiftAction } = applyShiftAction(startState, context, 'resilience');
  const plan = runSiloBudgetPlan(state, context, timeLimit, timeLimit);

  return {
    actions: [shiftAction, ...plan.actions],
    elapsedSeconds: plan.elapsedSeconds,
    endState: plan.endState,
  };
}
