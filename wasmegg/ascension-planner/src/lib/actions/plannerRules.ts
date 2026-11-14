type ArtifactModifiers = ReturnType<typeof calculateArtifactModifiers>;

/**
 * The action rules only the ascension planner has: shifts and waiting for Truth Eggs. Shared planner
 * code calls these, and the enlightenment planner has its own versions.
 */

import type { Action, CalculationsSnapshot, CurrentFarmState, ResearchLevels, ShiftPayload, StartAscensionPayload, VirtueEgg, WaitForTEPayload, FuelEgg } from '@/types';
import type { EngineState } from '@/engine/types';
import type { calculateArtifactModifiers } from '@/lib/artifacts';
import { useAutoPlannerStore } from '@/stores/autoPlanner';
import { useInitialStateStore } from '@/stores/initialState';
import { VIRTUE_EGGS, VIRTUE_EGG_NAMES } from '@/types';
import { useActionsStore } from '@/stores/actions';
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

/** What this planner's snapshots carry beyond the shared fields, read from the live stores. */
export function plannerSnapshotFields() {
  const planStore = usePlanStore();
  const truthEggsStore = useTruthEggsStore();
  return {
    currentEgg: planStore.currentEgg,
    shiftCount: planStore.shiftCount,
    te: planStore.te,
    eggsDelivered: { ...truthEggsStore.eggsDelivered },
    teEarned: { ...truthEggsStore.teEarned },
  };
}

/** Puts this planner's own snapshot fields back into the live stores. */
export function restorePlannerSnapshot(snapshot: CalculationsSnapshot): void {
  usePlanStore().$patch(state => {
    state.currentEgg = snapshot.currentEgg;
    state.shiftCount = snapshot.shiftCount;
    state.te = snapshot.te;
  });
  useTruthEggsStore().$patch(state => {
    if (snapshot.eggsDelivered) {
      state.eggsDelivered = { ...snapshot.eggsDelivered };
    }
    if (snapshot.teEarned) {
      state.teEarned = { ...snapshot.teEarned };
    }
  });
}

/** The state a start action sets that only this planner has. */
export function plannerStartFields(state: EngineState, payload: StartAscensionPayload) {
  return {
    currentEgg: payload.initialEgg,
    teEarned: { ...state.teEarned },
    eggsDelivered: { ...state.eggsDelivered },
  };
}

/** Applies a planner-only action to the engine state, or returns null if it isn't one. */
export function applyPlannerAction(state: EngineState, action: { type: string; payload: unknown; cost: number }): EngineState | null {
  if (action.type === 'shift') {
    const payload = action.payload as ShiftPayload;
    return {
      ...state,
      currentEgg: payload.toEgg,
      shiftCount: payload.newShiftCount,
      soulEggs: Math.max(0, state.soulEggs - action.cost),
      bankValue: 0,
      population: 1,
    };
  }
  if (action.type === 'wait_for_te') {
    const payload = action.payload as WaitForTEPayload;
    const newEggsDelivered = { ...state.eggsDelivered };
    newEggsDelivered[payload.egg] = (newEggsDelivered[payload.egg] || 0) + payload.eggsToLay;
    return { ...state, eggsDelivered: newEggsDelivered };
  }
  return null;
}

/** The earnings input that depends on how this planner works out its bonus. */
export function plannerEarningsBonus(state: EngineState, _epicResearchLevels: ResearchLevels, _artifactMods: ArtifactModifiers) {
  return { te: state.te };
}

/** The computed snapshot fields only this planner has. */
export function plannerComputedFields(state: EngineState) {
  return { currentEgg: state.currentEgg, shiftCount: state.shiftCount, teEarned: state.teEarned };
}

/** The simulation context fields only this planner has. */
export function plannerContextFields() {
  return { deferForEarningsMode: useAutoPlannerStore().deferForEarningsMode };
}

/** This planner's engine state taken from a snapshot. Runs without Pinia in workers, so it can't use stores. */
export function plannerStateFromSnapshot(snapshot: CalculationsSnapshot) {
  return {
    currentEgg: snapshot.currentEgg,
    shiftCount: snapshot.shiftCount,
    eggsDelivered: { ...snapshot.eggsDelivered },
    teEarned: { ...snapshot.teEarned },
  };
}

/** This planner's engine state before any snapshot exists. */
export function plannerFreshState() {
  const planStore = usePlanStore();
  const initialStateStore = useInitialStateStore();
  const farmEggType = initialStateStore.isContinuing ? initialStateStore.currentFarmState?.eggType : undefined;
  return {
    currentEgg: (farmEggType ? VIRTUE_EGGS[farmEggType - 50] : 'curiosity') as VirtueEgg,
    shiftCount: planStore.initialShiftCount,
    te: planStore.initialTE,
    eggsDelivered: { ...initialStateStore.initialEggsDelivered },
    teEarned: { ...initialStateStore.initialTeEarned },
  };
}

/** Gives a start action being reset the egg this planner needs. */
export function applyPlannerStartDefaults(startAction: Action<'start_ascension'>): void {
  startAction.payload.initialEgg = startAction.payload.initialEgg || 'curiosity';
}

/** Points the plan at the egg of the farm being continued, returning that egg for event matching. */
export function syncPlannerFarmEgg(farm: CurrentFarmState, startAction: Action<'start_ascension'> | undefined): string | undefined {
  const egg = VIRTUE_EGGS[farm.eggType - 50];
  if (startAction) startAction.payload.initialEgg = egg;
  usePlanStore().setCurrentEgg(egg);
  return egg;
}

/** The label for the shift being viewed, such as C1 or H2. */
export function plannerGroupName(egg: VirtueEgg): string {
  const actionsStore = useActionsStore();
  const eggName = VIRTUE_EGG_NAMES[egg];
  const letter = eggName.charAt(0).toUpperCase();

  // Find the 'header' action for the current group
  let headerAction: Action | undefined;

  if (actionsStore.editingGroupId) {
    headerAction = actionsStore.getAction(actionsStore.editingGroupId);
  } else {
    // If not editing, find the last group header in the entire list
    const actions = actionsStore.actions;
    for (let i = actions.length - 1; i >= 0; i--) {
      if (actions[i].type === 'shift' || actions[i].type === 'start_ascension') {
        headerAction = actions[i];
        break;
      }
    }
  }

  if (!headerAction) return `${letter}1`; // Fallback

  // Count how many times we visited this egg up to (and including) this header action
  // We iterate through all actions, counting visits to 'egg'
  // A visit starts at 'start_ascension' (if initialEgg matches) or 'shift' (if toEgg matches)
  let count = 0;
  for (const action of actionsStore.actions) {
    if (action.type === 'start_ascension') {
      const payload = action.payload as StartAscensionPayload;
      if (payload.initialEgg === egg) count++;
    } else if (action.type === 'shift') {
      const payload = action.payload as ShiftPayload;
      if (payload.toEgg === egg) count++;
    }

    // Stop when we reach our target header
    if (action.id === headerAction.id) break;
  }

  return `${letter}${count || 1}`;
}
