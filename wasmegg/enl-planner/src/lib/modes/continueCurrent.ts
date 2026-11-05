/**
 * @module initContinueCurrent
 * @description Mode C: Continue Current Ascension
 *
 * Contract:
 * - Fresh backup loaded (everything)
 * - Farm-specific stores populated from backup farm (research, habs, vehicles, silos)
 * - Start action: egg from backup farm, farm state = backup farm, isQuickContinue=true
 * - isContinuing=true (createBaseEngineState uses farm data)
 * - Ascension date/time = now
 * - Active events auto-pushed (earnings boost, relevant sales)
 * - Artifacts: depends on selection
 *   - 'earnings': backup loadout as earnings set
 *   - 'elr': backup loadout as elr set + computed optimal earnings
 *
 * Key invariant: start_action.initialFarmState MUST be set, isContinuing MUST be true.
 */

import { resetAllStores } from './reset';
import { fetchPlayerBackup } from './fetchBackup';
import { loadAndSyncBackup, catchUpFarmState } from './utils';
import { useActionsStore } from '@/stores/actions';
import { useInitialStateStore } from '@/stores/initialState';
import { useVirtueStore } from '@/stores/virtue';
import { computeSnapshot } from '@/engine/compute';
import { getSimulationContext, createBaseEngineState } from '@/engine/adapter';

export async function initContinueCurrent(
  playerId: string,
  artifactSet: 'earnings' | 'elr'
): Promise<void> {
  // 1. Clean slate
  await resetAllStores();

  // 2. Fetch backup
  const { backup } = await fetchPlayerBackup(playerId);

  // 3. Load from backup and sync global stores
  const initialStateStore = useInitialStateStore();
  const mode = artifactSet === 'earnings' ? 'continue_earnings' as const : 'continue_elr' as const;
  const { teEarnedPerEgg } = loadAndSyncBackup(playerId, backup, mode);

  // 4. Continue-specific virtue store setup
  const virtueStore = useVirtueStore();
  virtueStore.resetToCurrentDateTime();
  virtueStore.setBankValue(0); // Will be overridden by continueFromBackup

  // 5. Compute a catch-up snapshot and sync farm state
  //    (backup may be hours old — simulate time passage for egg delivery)
  const context = getSimulationContext();
  const baseState = createBaseEngineState(null);
  const catchUpSnapshot = computeSnapshot(baseState, context);

  catchUpFarmState(catchUpSnapshot, baseState.bankValue, context.ascensionStartTime, teEarnedPerEgg);

  // 6. Continue from backup — sets up start action with farm state,
  //    populates farm-specific stores, computes final snapshot, pushes events
  const actionsStore = useActionsStore();
  actionsStore.isReconciling = false;
  await actionsStore.continueFromBackup(true);
}
