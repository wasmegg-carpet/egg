import type { Action } from '@/types/actions/meta';
import { createSimAction } from '@/types/actions/meta';
import type { EngineState, SimulationContext, ShiftResult } from '../../types';
import { computeSnapshot } from '../../../engine/compute';
import { applyAction } from '../../../engine/apply';
import { advanceTimeFlat } from './advanceTime';
import { planSilosWithinBudget } from '../../../calculations/siloPurchasePlan';

/**
 * `planSilosWithinBudget` plans against a snapshot up front (growth-aware, via `getTimeToSave`);
 * this executes that plan step-by-step against a mutable `EngineState` using the flat-rate
 * `advanceTimeFlat`. See siloPurchasePlan.ts's note on flat-rate vs. growth-aware waits — this is
 * only correct once population has already reached hab capacity (TE >= 100 regime).
 */
export function runSiloBudgetPlan(
  startState: EngineState,
  context: SimulationContext,
  budgetSeconds: number,
  timeLimit: number
): ShiftResult {
  let currentState: EngineState = { ...startState };
  let elapsedSeconds = 0;
  const actions: Action[] = [];

  const startSnapshot = computeSnapshot(currentState, context, { skipGrowth: true });
  const plan = planSilosWithinBudget(startSnapshot, currentState.siloCount, budgetSeconds);

  for (const step of plan.steps) {
    if (elapsedSeconds + step.waitSeconds > timeLimit) break;

    const advanced = advanceTimeFlat(currentState, actions, elapsedSeconds, context, step.waitSeconds);
    currentState = advanced.currentState;
    elapsedSeconds = advanced.elapsedSeconds;

    const action = createSimAction('buy_silo', { fromCount: step.fromCount, toCount: step.toCount }, step.cost);
    currentState = applyAction(currentState, action);

    const finalSnap = computeSnapshot(currentState, context, { skipGrowth: true });
    action.endState = finalSnap;
    action.totalTimeSeconds = 0;
    action.bankDelta = -step.cost;

    actions.push(action);
  }

  return {
    actions,
    elapsedSeconds,
    endState: currentState,
  };
}
