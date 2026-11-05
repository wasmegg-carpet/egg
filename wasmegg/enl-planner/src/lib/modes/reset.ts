/**
 * @module resetAllStores
 * @description Resets ALL Pinia stores to their known-zero default state.
 *
 * Every mode initializer calls this as its first step to guarantee a clean
 * baseline. This eliminates cross-mode state leakage — the #1 source of
 * mode-specific bugs.
 *
 * After this function returns, every store is at its Pinia default:
 * - actionsStore: single start_ascension action (curiosity, no farm, no quick continue)
 * - initialStateStore: hasData=false, no backup, no farm state
 * - virtueStore: curiosity, 0 shifts, 0 TE, date=today, bank=0
 * - commonResearchStore: all research at level 0
 * - habCapacityStore: [hab_0, null, null, null]
 * - shippingCapacityStore: [{vehicleId: 0, trainLength: 1}]
 * - silosStore: siloCount=1
 * - fuelTankStore: tankLevel=0, all fuel amounts=0
 * - truthEggsStore: all eggsDelivered=0, all teEarned=0
 * - salesStore: no sales active, no earnings boost
 * - notesStore: empty notes array
 *
 * NOT reset (intentionally):
 * - eventsStore: holds game calendar data, not per-session state
 */

import { useActionsStore } from '@/stores/actions';
import { useInitialStateStore } from '@/stores/initialState';
import { useVirtueStore } from '@/stores/virtue';
import { useFuelTankStore } from '@/stores/fuelTank';
import { useTruthEggsStore } from '@/stores/truthEggs';
import { useCommonResearchStore } from '@/stores/commonResearch';
import { useHabCapacityStore } from '@/stores/habCapacity';
import { useShippingCapacityStore } from '@/stores/shippingCapacity';
import { useSilosStore } from '@/stores/silos';
import { useSalesStore } from '@/stores/sales';
import { useNotesStore } from '@/stores/notes';

/**
 * Reset all stores to their default state.
 *
 * The order matters:
 * 1. Clear the start action payload FIRST (before clearAll preserves it)
 * 2. Clear actions store flags that clearAll doesn't touch (showIncompleteOnly)
 * 3. Call clearAll (which resets isReconciling, reconcile*, activePlanId, editingGroupId)
 * 4. Reset all other stores to Pinia defaults
 *
 * Recalculation is SKIPPED — the caller (mode initializer) will compute and
 * set the initial snapshot after populating stores for its specific mode.
 */
export async function resetAllStores(): Promise<void> {
  const actionsStore = useActionsStore();

  // Mark the plan as "mid-init" until setInitialSnapshot()/importPlan() settles everything back
  // into a consistent state. Reactive consumers that combine values from multiple stores (e.g. the
  // milestone chain watchEffect in useResearchViews.ts) must not compute against the transitional
  // state between here and then — see the isPlanInitializing doc comment in stores/actions/types.ts.
  actionsStore.isPlanInitializing = true;

  // 1. Clean the start action payload before clearAll preserves it
  const startAction = actionsStore.getStartAction();
  if (startAction) {
    startAction.payload.initialFarmState = undefined;
    startAction.payload.isQuickContinue = false;
    startAction.payload.initialEgg = 'curiosity';
  }

  // 2. Clear flags that clearAll() does NOT touch
  actionsStore.showIncompleteOnly = false;

  // 3. Clear actions (preserves the cleaned start action, resets reconcile state)
  //    skipRecalculate=true because we haven't set up stores yet
  await actionsStore.clearAll(undefined, true);

  // 4. Reset every store to Pinia defaults
  useInitialStateStore().$reset();
  useVirtueStore().$reset();
  useFuelTankStore().$reset();
  useTruthEggsStore().$reset();
  useCommonResearchStore().$reset();
  useHabCapacityStore().$reset();
  useShippingCapacityStore().$reset();
  useSilosStore().$reset();
  useSalesStore().$reset();
  useNotesStore().$reset();
}
