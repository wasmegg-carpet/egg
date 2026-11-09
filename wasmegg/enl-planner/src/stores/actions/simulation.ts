/**
 * @module SimulationEngine
 * @description Core simulation logic for the Actions store.
 * Handles applying actions, recalculating history, and managing batch modes.
 *
 * Simulation Flow:
 * 1. Action is triggered (UI or auto-logic).
 * 2. Previous state is captured from the last action's endState.
 * 3. `applyAction` computes state changes.
 * 4. `computeSnapshot` derives all calculated metrics (ELR, IHR, etc.).
 * 5. Deltas are computed between previous and new snapshots.
 * 6. Store is synchronized to the new snapshot.
 */

import type { Action, CalculationsSnapshot } from '@/types';
import { createEmptySnapshot, generateActionId } from '@/types';
import { getSimulationContext } from 'lib/planners/engine/adapter';
import { simulateStep } from 'lib/planners/engine/simulate';
import { type EngineState } from '@/engine/types';

/**
 * Create default start action.
 */
export function createDefaultStartAction(): Action<'start_ascension'> {
  return {
    id: generateActionId(),
    index: 0,
    timestamp: Date.now(),
    type: 'start_ascension',
    payload: {},
    cost: 0,
    elrDelta: 0,
    offlineEarningsDelta: 0,
    eggValueDelta: 0,
    habCapacityDelta: 0,
    layRateDelta: 0,
    shippingCapacityDelta: 0,
    ihrDelta: 0,
    bankDelta: 0,
    populationDelta: 0,
    totalTimeSeconds: 0,
    endState: createEmptySnapshot(),
    dependsOn: [],
    dependents: [],
  };
}

/**
 * Internal helper to calculate a single action result.
 */
export function calculateActionResult(
  action: Action,
  prevSnapshot: CalculationsSnapshot,
  prevState: EngineState // EngineState
): { newSnapshot: CalculationsSnapshot; durationSeconds: number } {
  const step = simulateStep(action, prevSnapshot, prevState, getSimulationContext());
  return { newSnapshot: step.snapshot, durationSeconds: step.durationSeconds };
}
