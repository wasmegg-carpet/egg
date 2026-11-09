/**
 * The action rules only the enlightenment planner has: waiting for population. Shared planner code
 * calls these, and the ascension planner has its own versions.
 */

import type { Action, CalculationsSnapshot, FuelEgg } from '@/types';
import { FARM_EGG } from '@/types';

/** Which payload field holds this planner-only action's duration, if it is one. */
export function plannerDurationField(type: string): 'timeSeconds' | 'totalTimeSeconds' | null {
  return type === 'wait_for_population' ? 'totalTimeSeconds' : null;
}

/** This planner-only action recalculated for the state before it, or null if it isn't one. */
export function refreshPlannerPayload(action: Action, prevSnapshot: CalculationsSnapshot): Action | null {
  if (action.type !== 'wait_for_population') return null;
    const payload = { ...(action.payload as import('@/types').WaitForPopulationPayload) };
    payload.currentPopulation = prevSnapshot.population;
    payload.ihr = prevSnapshot.offlineIHR;
    payload.reachable = payload.targetPopulation <= prevSnapshot.habCapacity;
    const target = Math.min(payload.targetPopulation, prevSnapshot.habCapacity);
    const chickensNeeded = Math.max(0, target - payload.currentPopulation);
    payload.totalTimeSeconds = payload.ihr > 0 ? chickensNeeded / (payload.ihr / 60) : 0;
    return { ...action, payload };
}

/** Enlightenment has no planner-only store effects to replay. */
export function applyPlannerReplayEffect(_action: Action): void {}

export function registerPlannerStrategies(registerStrategy: typeof import('lib/planners/actions/reconciliation').registerStrategy): void {
  registerStrategy('wait_for_population', {
    evaluate(action, context) {
      if (!context.farm) return 'pending';
      return context.farm.population >= action.payload.targetPopulation ? 'completed' : 'pending';
    }
  });
}

/** Enlightenment plans have no shifts, so a past group is never edited. */
export async function confirmPastGroupEdit(
  _actions: Action[],
  _action: unknown,
  _insertIndex: number,
  _removeActions: (ids: string[]) => Promise<void>
): Promise<boolean> {
  return true;
}

/** The egg an action row shows, if any. */
export function plannerActionEgg(action: Action): FuelEgg | null {
  return action.type === 'start_ascension' ? FARM_EGG : null;
}

/** The icon for a planner-only action's row, if it is one. */
export function plannerActionIconPath(type: string): string | null {
  return type === 'wait_for_population' ? 'egginc/ei_hab_icon_chicken_universe.png' : null;
}
