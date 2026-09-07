import type { EngineState, SimulationContext, ShiftResult } from '../types';
import { applyShiftAction } from './helpers/actionHelpers';
import { runMaxVehiclesPlan } from './helpers/vehicles';

/**
 * K2 Shift Strategy:
 * 1. Shift to Kindness.
 * 2. Max all vehicle slots with best vehicles (Hyperloops, ID 11).
 * 3. Max train lengths.
 */
export function runK2(startState: EngineState, context: SimulationContext): ShiftResult {
  const { state, action: shiftAction } = applyShiftAction(startState, context, 'kindness');
  const plan = runMaxVehiclesPlan(state, context, Infinity);

  return {
    actions: [shiftAction, ...plan.actions],
    elapsedSeconds: plan.elapsedSeconds,
    endState: plan.endState,
  };
}
