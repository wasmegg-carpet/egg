import type { EngineState, SimulationContext, ShiftResult } from '../types';
import { applyShiftAction } from './helpers/actionHelpers';
import { runVehiclesForTimeLimit } from './helpers/vehicles';

/**
 * K1 Shift Strategy:
 * 1. Shift to Kindness.
 * 2. Buy as many vehicles as the time budget allows, maximizing shipping capacity.
 *
 * Uses `runVehiclesForTimeLimit` (ROI-ranked across every slot and vehicle tier), not
 * `runMaxVehiclesPlan` (which only ever plans Hyperloop, one slot fully maxed before the
 * next) — this shift's default 1800s budget is early in an ascension when earnings are
 * low, and a low earner typically can't afford even one Hyperloop in that window. The
 * ROI-ranked planner spreads affordable cheap vehicles across many slots instead of
 * stalling the whole budget on a single unreachable Hyperloop purchase and buying nothing
 * else. See `planVehiclesForTimeLimit`'s doc comment for the full rationale.
 */
export function runK1(startState: EngineState, context: SimulationContext, timeLimit: number = 1800): ShiftResult {
  const { state, action: shiftAction } = applyShiftAction(startState, context, 'kindness');
  const plan = runVehiclesForTimeLimit(state, context, timeLimit);

  return {
    actions: [shiftAction, ...plan.actions],
    elapsedSeconds: plan.elapsedSeconds,
    endState: plan.endState,
  };
}
