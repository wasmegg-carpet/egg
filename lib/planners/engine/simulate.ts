import type { Action, CalculationsSnapshot } from '@planner/types';
import type { EngineState, SimulationContext } from '@planner/engine/types';
import { applyAction, applyTime, getActionDuration, refreshActionPayload } from '@planner/engine/apply';
import { computeSnapshot } from './compute';
import { computeDeltas } from '../actions/snapshot';
import { boostTransitionsFrom } from './apply/math';
import { withCalendarEarningsBoost, withCalendarResearchSale } from './calendarEvents';
import { applyPassiveEggs, computePassiveEggsDelivered } from './passiveEggs';
import { yieldForOverlayPaint } from '../yieldForOverlayPaint';

export interface SimulationStep {
  state: EngineState;
  snapshot: CalculationsSnapshot;
  durationSeconds: number;
  /** The offset the plan's later steps are measured from. */
  planStartOffset: number;
}

/**
 * Applies one action on top of a known state. Every replay path goes through here, so the action's
 * duration, earnings, calendar events and resulting snapshot can't differ between them.
 */
export function simulateStep(
  action: Action,
  prevSnapshot: CalculationsSnapshot,
  prevState: EngineState,
  context: SimulationContext
): SimulationStep {
  let state = applyAction(prevState, action);

  // Eggs are shipped at the previous snapshot's rate while saving for the action.
  const durationSeconds = getActionDuration(action, prevSnapshot, context);
  state = applyPassiveEggs(state, computePassiveEggsDelivered(action, durationSeconds, prevSnapshot));

  const absoluteSimTime = context.ascensionStartTime + (prevSnapshot.lastStepTime - context.planStartOffset);
  state = applyTime(state, durationSeconds, prevSnapshot, {
    skipGrowth: action.type === 'wait_for_no_earnings',
    skipEarnings: action.type === 'store_fuel',
    transitions: boostTransitionsFrom(prevSnapshot, absoluteSimTime),
  });

  // Set before computing the snapshot, whose earnings rate depends on it. A start action defines the
  // plan's zero, so it's measured from its own time.
  const isStart = action.type === 'start_ascension';
  state = withCalendarEarningsBoost(
    state,
    context.ascensionStartTime,
    isStart ? state.lastStepTime : context.planStartOffset
  );
  const computed = computeSnapshot(state, context, {
    freezePopulation: action.type === 'wait_for_no_earnings',
    skipEpochConversion: true,
  });

  // `context.planStartOffset` can predate the start action being recalculated here; that action's own
  // end time is the offset everything after it is measured from.
  const planStartOffset = isStart ? computed.lastStepTime : context.planStartOffset;
  const snapshot = withCalendarResearchSale(computed, context.ascensionStartTime, planStartOffset);

  return {
    // The next action has to start from what the snapshot worked out, or it would use stale values.
    state: {
      ...state,
      activeSales: snapshot.activeSales,
      population: snapshot.population,
      bankValue: snapshot.bankValue,
      lastStepTime: snapshot.lastStepTime,
      eggsDelivered: { ...snapshot.eggsDelivered },
      fuelTankAmounts: { ...snapshot.fuelTankAmounts },
    },
    snapshot,
    durationSeconds,
    planStartOffset,
  };
}

/** Replays actions in order, collecting each one's refreshed payload, deltas and end state. */
function startReplay(context: SimulationContext, baseState: EngineState, startIndex: number) {
  // skipEpochConversion keeps lastStepTime in the plan's native reference frame (relative or epoch)
  // so that mid-plan recalculations don't corrupt the plan's time axis.
  let snapshot = computeSnapshot(baseState, context, { skipEpochConversion: true });
  let state = baseState;
  let planStartOffset = context.planStartOffset;
  const results: Action[] = [];

  return {
    results,
    replay(original: Action) {
      const stepContext = { ...context, planStartOffset };
      const action = refreshActionPayload(original, snapshot, stepContext);
      const step = simulateStep(action, snapshot, state, stepContext);
      results.push({
        ...action,
        index: startIndex + results.length,
        ...computeDeltas(snapshot, step.snapshot),
        totalTimeSeconds: step.durationSeconds,
        endState: step.snapshot, // Caller should markRaw this if using Vue
      });
      state = step.state;
      snapshot = step.snapshot;
      planStartOffset = step.planStartOffset;
    },
  };
}

/**
 * Simulate a list of actions to produce a timeline of states.
 * @param actions The list of actions to simulate (including start_ascension)
 * @param context Global context (epic research, colleggtibles)
 * @param baseState The specific starting state
 * @param startIndex The index offset for the first action in the list (default 0)
 * @returns The list of actions with updated endState and deltas
 */
export function simulate(
  actions: Action[],
  context: SimulationContext,
  baseState: EngineState,
  startIndex: number = 0
): Action[] {
  const run = startReplay(context, baseState, startIndex);
  actions.forEach(run.replay);
  return run.results;
}

/** Async version of simulate that yields to the event loop to allow UI updates. */
export async function simulateAsync(
  actions: Action[],
  context: SimulationContext,
  baseState: EngineState,
  onProgress?: (current: number, total: number) => void,
  startIndex: number = 0
): Promise<Action[]> {
  // A smaller number makes the UI smoother but the total time slightly longer.
  const YIELD_INTERVAL = 20;
  const run = startReplay(context, baseState, startIndex);

  for (let i = 0; i < actions.length; i++) {
    if (i % YIELD_INTERVAL === 0) {
      onProgress?.(i, actions.length);
      await yieldForOverlayPaint();
    }
    run.replay(actions[i]);
  }

  onProgress?.(actions.length, actions.length);
  return run.results;
}
