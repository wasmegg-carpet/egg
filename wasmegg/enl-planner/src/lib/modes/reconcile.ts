/**
 * @module initReconcile
 * @description Mode D: Reconcile Plan
 *
 * Contract:
 * - Fresh backup loaded for live comparison data
 * - Plan loaded from library (stores hydrated from plan data, actions from plan)
 * - isReconciling=true
 * - reconcileFarmState = snapshot of live farm from backup
 * - reconcileEggsDelivered / reconcileTeEarned = live values from backup
 * - Plan's stores NOT overwritten by backup (backup is only for comparison)
 *
 * Ordering is critical:
 * 1. Fetch backup (populates initialStateStore with live data)
 * 2. Capture live comparison targets BEFORE plan import overwrites stores
 * 3. Load plan from library (overwrites stores with plan data via hydrate)
 * 4. Set reconciliation mode and comparison targets
 * 5. Re-assert the live backup — step 3's hydrate reads the *plan's own*
 *    `rawBackup` (a redacted, possibly stale snapshot from whenever the plan
 *    was last saved — see `redactBackupForStorage`) and would otherwise
 *    silently replace the live one step 1 fetched, contradicting this mode's
 *    whole point of comparing against *live* data.
 */

import { resetAllStores } from './reset';
import { fetchPlayerBackup } from './fetchBackup';
import { loadAndSyncBackup, captureReconciliationTargets } from './utils';
import { useActionsStore } from '@/stores/actions';
import { useInitialStateStore } from '@/stores/initialState';
import type { PlanData } from '@/lib/storage/db';

export async function initReconcile(
  playerId: string,
  plan: PlanData,
  broadcastPresence?: (planId: string) => void
): Promise<void> {
  // 1. Clean slate
  await resetAllStores();

  // 2. Fetch backup for live comparison data
  const { backup } = await fetchPlayerBackup(playerId);

  // 3. Load backup into initialStateStore and temporarily populate global stores
  //    (mode='reconcile' → loadAndSyncBackup handles Virtue/FuelTank but NOT TruthEggs)
  loadAndSyncBackup(playerId, backup, 'reconcile');

  // 4. Capture live comparison targets BEFORE the plan import overwrites stores
  captureReconciliationTargets();

  // 5. Set reconciliation mode
  const actionsStore = useActionsStore();
  actionsStore.isReconciling = true;
  actionsStore.showIncompleteOnly = true;

  // 6. Broadcast presence immediately to block other tabs
  if (broadcastPresence) {
    broadcastPresence(plan.id);
  }

  // 7. Load the plan from library — this overwrites stores with plan data
  //    (importPlanLogic → hydrate overwrites initialStateStore, virtue, fuelTank, truthEggs, notes)
  await actionsStore.loadPlanFromLibrary(plan);

  // 8. Re-assert the live backup fetched in step 2 — see the module doc comment's ordering note.
  useInitialStateStore().rawBackup = backup;
}

/**
 * Refresh an in-progress reconciliation by re-fetching the live backup and
 * re-capturing comparison targets. Unlike initReconcile this does NOT reset
 * stores, re-broadcast presence, or re-load the plan — the plan is already
 * loaded and we just want fresh live data to compare against it.
 */
export async function refreshReconcile(playerId: string): Promise<void> {
  const { backup } = await fetchPlayerBackup(playerId);
  loadAndSyncBackup(playerId, backup, 'reconcile');
  captureReconciliationTargets();
}
