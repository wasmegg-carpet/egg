import type { Action } from '@/types/actions/meta';
import type { EngineState, SimulationContext } from '../types';
import { computeSnapshot } from '../../engine/compute';
import { applyAction } from '../../engine/apply';

/**
 * Calculates the total eggs laid during a sequence of actions.
 * Assumes habitats were full the entire time.
 */
export function calculateEggsLaidDuringActions(
  actions: Action[],
  startState: EngineState,
  context: SimulationContext
): number {
  let currentState = { ...startState };
  let totalEggs = 0;

  for (const action of actions) {
    // Before applying the action, we compute the ELR of the current state.
    // If the action has a duration, we lay eggs at this ELR — except wait_for_te, which already
    // carries the exact eggs-to-lay figure computed for its (possibly variable-rate) wait.
    const snap = computeSnapshot(currentState, context, { skipGrowth: true });

    if (action.type === 'wait_for_te') {
      totalEggs += action.payload.eggsToLay || 0;
    } else if (
      action.type === 'wait_for_time' ||
      action.type === 'wait_for_research_sale' ||
      action.type === 'wait_for_earnings_boost' ||
      action.type === 'wait_for_full_habs' ||
      action.type === 'wait_for_missions'
    ) {
      const duration = action.payload.totalTimeSeconds || 0;
      totalEggs += snap.elr * duration;
    } else if (action.type === 'wait_for_gems') {
      // WaitForGemsPayload names its duration field `timeSeconds`, not `totalTimeSeconds`.
      const duration = action.payload.timeSeconds || 0;
      totalEggs += snap.elr * duration;
    }

    // Apply the action to move to the next state
    currentState = applyAction(currentState, action);
  }

  return totalEggs;
}
