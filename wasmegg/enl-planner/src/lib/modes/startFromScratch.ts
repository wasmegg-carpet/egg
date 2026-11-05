/**
 * @module initStartFromScratch
 * @description Mode A: Start from Scratch
 *
 * Contract:
 * - No backup data loaded
 * - All stores at defaults
 * - Start action: egg=curiosity, no farm state, no quick continue
 * - A "Wait for Full Habs" action is auto-added by setInitialSnapshot
 */

import { resetAllStores } from './reset';
import { useActionsStore } from '@/stores/actions';
import { computeSnapshot } from '@/engine/compute';
import { getSimulationContext, createBaseEngineState } from '@/engine/adapter';

export async function initStartFromScratch(): Promise<void> {
  // 1. Clean slate — all stores to defaults
  await resetAllStores();

  // 2. Compute initial snapshot from default stores
  //    (curiosity egg, no research, no farm state, population=0)
  const context = getSimulationContext();
  const baseState = createBaseEngineState(null);
  const initialSnapshot = computeSnapshot(baseState, context);

  // 3. Set initial snapshot (triggers recalculate + auto-adds Wait for Full Habs)
  const actionsStore = useActionsStore();
  await actionsStore.setInitialSnapshot(initialSnapshot);
}
