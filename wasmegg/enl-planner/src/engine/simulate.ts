import type { Action, CalculationsSnapshot } from '@/types';
import type { EngineState, SimulationContext } from './types';
import {
  applyAction,
  applyTime,
  getActionDuration,
  refreshActionPayload,
  boostTransitionsFrom,
} from './apply';
import { computeSnapshot } from './compute';
import { withCalendarResearchSale } from './researchSale';
import { computeDeltas } from '@/lib/actions/snapshot';
import { yieldForOverlayPaint } from 'lib/planners/yieldForOverlayPaint';

/**
 * Simulate a list of actions to produce a timeline of states.
 * @param actions The list of actions to simulate (including start_ascension)
 * @param context Global context (epic research, colleggtibles)
 * @param baseState The specific starting state (SE, PE, TE, empty farm)
 * @returns The list of actions with updated endState and deltas
 */
/**
 * Simulate a list of actions to produce a timeline of states.
 * @param actions The list of actions to simulate (including start_ascension)
 * @param context Global context (epic research, colleggtibles)
 * @param baseState The specific starting state (SE, PE, TE, empty farm)
 * @param startIndex The index offset for the first action in the list (default 0)
 * @returns The list of actions with updated endState and deltas
 */
export function simulate(
  actions: Action[],
  context: SimulationContext,
  baseState: EngineState,
  startIndex: number = 0
): Action[] {
  const results: Action[] = [];
  let previousSnapshot: CalculationsSnapshot | null = null;

  // We need a way to treat baseState as a Snapshot for delta computation of the first action.
  // However, computeDeltas expects a full CalculationsSnapshot.
  // We can compute the "base snapshot" once.
  // skipEpochConversion keeps lastStepTime in the plan's native reference frame (relative or epoch)
  // so that mid-plan recalculations don't corrupt the plan's time axis.
  const baseSnapshot = computeSnapshot(baseState, context, { skipEpochConversion: true });

  let currentState = baseState;
  let currentSnapshot = baseSnapshot;
  let planStartOffset = context.planStartOffset;

  for (let i = 0; i < actions.length; i++) {
    let action = actions[i];
    const actualIndex = startIndex + i;
    const stepContext = { ...context, planStartOffset };

    // 0. Refresh dynamic payloads (e.g. wait_for_population duration based on new IHR)
    action = refreshActionPayload(action, currentSnapshot, stepContext);

    // 1. Apply action to get new pure state
    currentState = applyAction(currentState, action);

    // 1b. Add passively delivered eggs during this action's duration
    // Uses the PREVIOUS snapshot's ELR (eggs are shipped at the old rate while saving for the action)
    const durationSeconds = getActionDuration(action, currentSnapshot, stepContext);

    const absoluteSimTime = context.ascensionStartTime + (currentSnapshot.lastStepTime - planStartOffset);
    currentState = applyTime(currentState, durationSeconds, currentSnapshot, {
      skipGrowth: action.type === 'wait_for_no_earnings',
      skipEarnings: action.type === 'store_fuel',
      transitions: boostTransitionsFrom(currentSnapshot, absoluteSimTime),
    });

    // 2. Compute full snapshot
    const computedSnapshot = computeSnapshot(currentState, context, {
      freezePopulation: action.type === 'wait_for_no_earnings',
      skipEpochConversion: true,
    });
    // `context.planStartOffset` was read before this pass, so it can predate the start action being
    // recalculated here; that action's own end time is the offset everything after it is measured from.
    if (action.type === 'start_ascension') planStartOffset = computedSnapshot.lastStepTime;
    const newSnapshot = withCalendarResearchSale(computedSnapshot, context.ascensionStartTime, planStartOffset);
    currentState = { ...currentState, activeSales: newSnapshot.activeSales };

    // 3. Compute deltas vs previous state
    // For the first action, we compare against baseSnapshot (or should we?)
    // In the current store, start_ascension has 0 deltas usually.
    // computeDeltas(baseSnapshot, newSnapshot) might show diffs if start_ascension changed the egg.
    const prevSnap = i === 0 ? baseSnapshot : previousSnapshot!;

    // 3. Compute deltas vs previous state
    const deltas = computeDeltas(prevSnap, newSnapshot);

    // 4. Update action with new results and correct index
    results.push({
      ...action,
      index: actualIndex,
      ...deltas,
      totalTimeSeconds: durationSeconds,
      endState: newSnapshot, // Caller should markRaw this if using Vue
    });

    // 5. Update currentState for the next iteration.
    // This is CRITICAL: simulation must propagate the computed state
    // (population, egg delivery, etc.) to the next action or else
    // subsequent actions will start from stale states.
    currentState = {
      ...currentState,
      population: newSnapshot.population,
      bankValue: newSnapshot.bankValue,
      lastStepTime: newSnapshot.lastStepTime,
      // Also ensure cumulative lifecycle eggs/fuel are preserved from computeSnapshot if they changed
      fuelTankAmounts: { ...newSnapshot.fuelTankAmounts },
    };

    previousSnapshot = newSnapshot;
    currentSnapshot = newSnapshot;
  }

  return results;
}

/**
 * Async version of simulate that yields to the event loop to allow UI updates.
 */
export async function simulateAsync(
  actions: Action[],
  context: SimulationContext,
  baseState: EngineState,
  onProgress?: (current: number, total: number) => void,
  startIndex: number = 0
): Promise<Action[]> {
  const results: Action[] = [];
  let previousSnapshot: CalculationsSnapshot | null = null;
  const baseSnapshot = computeSnapshot(baseState, context, { skipEpochConversion: true });

  let currentState = baseState;
  let currentSnapshot = baseSnapshot;
  let planStartOffset = context.planStartOffset;

  // Yield every 20 actions to keep UI responsive
  // A smaller number makes the UI smoother but total time slightly longer
  const YIELD_INTERVAL = 20;

  for (let i = 0; i < actions.length; i++) {
    // Yield check
    if (i % YIELD_INTERVAL === 0) {
      if (onProgress) onProgress(i, actions.length);
      await yieldForOverlayPaint();
    }

    let action = actions[i];
    const actualIndex = startIndex + i;
    const stepContext = { ...context, planStartOffset };

    action = refreshActionPayload(action, currentSnapshot, stepContext);
    currentState = applyAction(currentState, action);
    const durationSeconds = getActionDuration(action, currentSnapshot, stepContext);

    const absoluteSimTime = context.ascensionStartTime + (currentSnapshot.lastStepTime - planStartOffset);
    const transitions = boostTransitionsFrom(currentSnapshot, absoluteSimTime);
    currentState = applyTime(currentState, durationSeconds, currentSnapshot, {
      skipGrowth: action.type === 'wait_for_no_earnings',
      skipEarnings: action.type === 'store_fuel',
      transitions,
    });

    const computedSnapshot = computeSnapshot(currentState, context, {
      freezePopulation: action.type === 'wait_for_no_earnings',
      skipEpochConversion: true,
    });
    // `context.planStartOffset` was read before this pass, so it can predate the start action being
    // recalculated here; that action's own end time is the offset everything after it is measured from.
    if (action.type === 'start_ascension') planStartOffset = computedSnapshot.lastStepTime;
    const newSnapshot = withCalendarResearchSale(computedSnapshot, context.ascensionStartTime, planStartOffset);
    currentState = { ...currentState, activeSales: newSnapshot.activeSales };
    const prevSnap = i === 0 ? baseSnapshot : previousSnapshot!;
    const deltas = computeDeltas(prevSnap, newSnapshot);
    results.push({
      ...action,
      index: actualIndex,
      ...deltas,
      totalTimeSeconds: durationSeconds,
      endState: newSnapshot,
    });
    currentState = {
      ...currentState,
      population: newSnapshot.population,
      bankValue: newSnapshot.bankValue,
      lastStepTime: newSnapshot.lastStepTime,
      fuelTankAmounts: { ...newSnapshot.fuelTankAmounts },
    };
    previousSnapshot = newSnapshot;
    currentSnapshot = newSnapshot;
  }

  // Final progress update
  if (onProgress) onProgress(actions.length, actions.length);

  return results;
}
