/**
 * The action rules only the ascension planner has: shifts and waiting for Truth Eggs. Shared planner
 * code calls these, and the enlightenment planner has its own versions.
 */

import type { Action, CalculationsSnapshot, ShiftPayload, StartAscensionPayload, WaitForTEPayload, FuelEgg } from '@/types';
import { VIRTUE_EGGS } from '@/types';
import { solveForTime } from 'lib/planners/engine/apply/math';
import { safeImport } from 'lib/planners/import';
import { countTEThresholdsPassed, eggsNeededForTE } from '@/lib/truthEggs';
import { usePlanStore } from '@/stores/plan';
import { useTruthEggsStore } from '@/stores/truthEggs';

/** Which payload field holds this planner-only action's duration, if it is one. */
export function plannerDurationField(type: string): 'timeSeconds' | 'totalTimeSeconds' | null {
  return type === 'wait_for_te' ? 'timeSeconds' : null;
}

/** This planner-only action recalculated for the state before it, or null if it isn't one. */
export function refreshPlannerPayload(action: Action, prevSnapshot: CalculationsSnapshot): Action | null {
  if (action.type !== 'wait_for_te') return null;
    const payload = { ...(action.payload as WaitForTEPayload) };
    const egg = payload.egg;
    const currentDelivered = prevSnapshot.eggsDelivered[egg] || 0;
    payload.eggsToLay = eggsNeededForTE(currentDelivered, payload.targetTE);
    payload.timeSeconds = solveForTime(
      payload.eggsToLay,
      prevSnapshot.population,
      prevSnapshot.offlineIHR / 60,
      prevSnapshot.ratePerChickenPerSecond,
      prevSnapshot.shippingCapacity,
      prevSnapshot.habCapacity
    );
    payload.startEggsDelivered = currentDelivered;
    const thresholdsPassed = countTEThresholdsPassed(currentDelivered);
    const claimedTE = prevSnapshot.teEarned?.[egg] || 0;
    payload.startTE = Math.max(claimedTE, thresholdsPassed);
    payload.teGained = Math.max(0, payload.targetTE - payload.startTE);
    return { ...action, payload };
}

/** Applies a planner-only action to the stores during a replay. */
export function applyPlannerReplayEffect(action: Action): void {
  switch (action.type) {
    case 'shift': {
      const payload = action.payload as ShiftPayload;
      const planStore = usePlanStore();
      planStore.setCurrentEgg(payload.toEgg);
      planStore.setShiftCount(payload.newShiftCount);
      break;
    }

    case 'wait_for_te': {
      const payload = action.payload as WaitForTEPayload;
      const truthEggsStore = useTruthEggsStore();
      const planStore = usePlanStore();
      // Add eggs delivered
      truthEggsStore.addEggsDelivered(payload.egg, payload.eggsToLay);
      // Update TE
      planStore.setTE(planStore.te + payload.teGained);
      break;
    }
  }
}

export function registerPlannerStrategies(registerStrategy: typeof import('lib/planners/actions/reconciliation').registerStrategy): void {
  registerStrategy('wait_for_te', {
    evaluate(action, context) {
      const { egg, targetTE } = action.payload;
      const delivered = context.initialState.initialEggsDelivered[egg] || 0;
      const earned = context.initialState.initialTeEarned[egg] || 0;
      const theoretical = countTEThresholdsPassed(delivered);
      const currentTE = Math.max(earned, theoretical);
      return currentTE >= targetTE ? 'completed' : 'pending';
    }
  });

  registerStrategy('shift', {
    evaluate(action, context) {
      if (!context.farm) return 'pending';
      const { toEgg } = action.payload;
      const currentEggIndex = context.farm.eggType - 50;
      const targetEggIndex = VIRTUE_EGGS.indexOf(toEgg);
      return currentEggIndex >= targetEggIndex ? 'completed' : 'pending';
    }
  });
}

/** Whether an edit to a past shift can go ahead, after asking about any plan conflicts it causes. */
export async function confirmPastGroupEdit(
  actions: Action[],
  action: Parameters<typeof import('@/lib/continuity').checkAndHandleContinuity>[1],
  insertIndex: number,
  removeActions: (ids: string[]) => Promise<void>
): Promise<boolean> {
  const { checkAndHandleContinuity } = await safeImport(() => import('@/lib/continuity'));
  return checkAndHandleContinuity(actions, action, insertIndex, removeActions);
}

/** The egg an action row shows, if any. */
export function plannerActionEgg(action: Action): FuelEgg | null {
  if (action.type === 'start_ascension') return (action.payload as StartAscensionPayload).initialEgg;
  if (action.type === 'shift') return (action.payload as ShiftPayload).toEgg;
  return null;
}

/** The icon for a planner-only action's row, if it is one. */
export function plannerActionIconPath(type: string): string | null {
  return type === 'wait_for_te' ? 'egginc/egg_truth.png' : null;
}
