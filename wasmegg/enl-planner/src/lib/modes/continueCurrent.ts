/**
 * @module initContinueCurrent
 * @description Mode C: Continue the current enlightenment farm
 *
 * Contract:
 * - Fresh backup loaded (everything); fails if the save has no enlightenment farm
 * - Farm-specific stores populated from backup farm (research, habs, vehicles, silos)
 * - Start action: farm state = backup farm, isQuickContinue=true
 * - isContinuing=true (createBaseEngineState uses farm data)
 * - Start date/time = now
 * - Active events auto-pushed (earnings boost, relevant sales)
 * - Artifacts: the backup's loadout
 *
 * Key invariant: start_action.initialFarmState MUST be set, isContinuing MUST be true.
 */

import { resetAllStores } from './reset';
import { fetchPlayerBackup } from './fetchBackup';
import { loadAndSyncBackup, catchUpFarmState } from './utils';
import { useActionsStore } from '@/stores/actions';
import { useInitialStateStore } from '@/stores/initialState';
import { usePlanStore } from '@/stores/plan';
import { computeSnapshot } from '@/engine/compute';
import { getSimulationContext, createBaseEngineState } from '@/engine/adapter';

export async function initContinueCurrent(playerId: string): Promise<void> {
  // 1. Clean slate
  await resetAllStores();

  // 2. Fetch backup
  const { backup } = await fetchPlayerBackup(playerId);

  // 3. Load from backup and sync global stores
  const initialStateStore = useInitialStateStore();
  loadAndSyncBackup(playerId, backup, 'continue');
  if (!initialStateStore.currentFarmState) {
    throw new Error('This save is not on the Enlightenment egg, so there is no farm to continue.');
  }

  // 4. Continue-specific setup
  const planStore = usePlanStore();
  planStore.resetToCurrentDateTime();
  planStore.setBankValue(0); // Will be overridden by continueFromBackup

  // 5. Compute a catch-up snapshot and sync farm state
  //    (backup may be hours old — simulate time passage for egg delivery)
  const context = getSimulationContext();
  const baseState = createBaseEngineState(null);
  const catchUpSnapshot = computeSnapshot(baseState, context);

  catchUpFarmState(catchUpSnapshot, baseState.bankValue, context.ascensionStartTime);

  // 6. Continue from backup — sets up start action with farm state,
  //    populates farm-specific stores, computes final snapshot, pushes events
  const actionsStore = useActionsStore();
  actionsStore.isReconciling = false;
  await actionsStore.continueFromBackup(true);
}
