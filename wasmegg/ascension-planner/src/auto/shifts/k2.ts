import type { EngineState, SimulationContext, ShiftResult } from '../types';
import { applyShiftIfNeeded } from './helpers/actionHelpers';
import { runMaxVehiclesPlan } from './helpers/vehicles';

/**
 * K2 Shift Strategy:
 * 1. Shift to Kindness.
 * 2. Max all vehicle slots with best vehicles (Hyperloops, ID 11).
 * 3. Max train lengths.
 */
export function runK2(startState: EngineState, context: SimulationContext): ShiftResult {
  const { state, actions: shiftActions } = applyShiftIfNeeded(startState, context, 'kindness');
  const plan = runMaxVehiclesPlan(state, context, Infinity);

  return {
    actions: [...shiftActions, ...plan.actions],
    elapsedSeconds: plan.elapsedSeconds,
    endState: plan.endState,
  };
}
