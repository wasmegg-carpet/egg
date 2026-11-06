/**
 * @module initPlanFuture
 * @description Mode B: Plan a new enlightenment farm
 *
 * Contract:
 * - Fresh backup loaded for global progress (epic research, artifacts, SE, PE, TE, fuel)
 * - Farm-specific stores ZEROED (research, habs, vehicles, silos, bank)
 * - Start action: no farm state, no quick continue
 * - Start date/time = now
 * - Artifacts: the max offline earnings set
 * - "Wait for Full Habs" auto-added by setInitialSnapshot
 *
 * Key invariant: currentFarmState is populated by loadFromBackup but NOT used
 * (isContinuing=false, start action has no farm state).
 */

import { resetAllStores } from './reset';
import { fetchPlayerBackup } from './fetchBackup';
import { loadAndSyncBackup, equipMaxEarningsSet } from './utils';
import { useActionsStore } from '@/stores/actions';
import { usePlanStore } from '@/stores/plan';
import { computeSnapshot } from '@/engine/compute';
import { getSimulationContext, createBaseEngineState } from '@/engine/adapter';

export async function initPlanFuture(playerId: string): Promise<void> {
  // 1. Clean slate
  await resetAllStores();

  // 2. Fetch backup
  const { backup } = await fetchPlayerBackup(playerId);

  // 3. Load global progress from backup and sync stores
  loadAndSyncBackup(playerId, backup, 'plan_next');

  // 5. Plan-specific setup
  const planStore = usePlanStore();
  planStore.resetToCurrentDateTime();
  planStore.setBankValue(0);

  // 6. Ensure start action is clean (resetAllStores already did this, but explicit)
  const actionsStore = useActionsStore();
  const startAction = actionsStore.getStartAction();
  if (startAction) {
    startAction.payload.initialFarmState = undefined;
    startAction.payload.isQuickContinue = false;
  }

  // Start with the max offline earnings artifact set
  equipMaxEarningsSet();

  // 7. Compute and set initial snapshot
  const context = getSimulationContext();
  const baseState = createBaseEngineState(null);
  const initialSnapshot = computeSnapshot(baseState, context);
  await actionsStore.setInitialSnapshot(initialSnapshot);
}
