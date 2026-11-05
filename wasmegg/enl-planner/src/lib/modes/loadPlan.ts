/**
 * @module initLoadPlan
 * @description Mode E: Load Saved Plan
 *
 * Contract:
 * - All stores hydrated from the plan's serialized state
 * - No *live* backup fetch needed for the plan itself to load — but see step 3:
 *   if the plan didn't already carry a redacted backup (older plan, or saved
 *   with no resolvable player ID), one is fetched and backfilled in now.
 * - Not reconciling
 * - Actions loaded from plan
 * - activePlanId set to the plan's ID
 */

import { resetAllStores } from './reset';
import { backfillMissingBackup } from './utils';
import { useActionsStore } from '@/stores/actions';
import type { PlanData } from '@/lib/storage/db';

export async function initLoadPlan(plan: PlanData): Promise<void> {
  // 1. Clean slate — prevents stale state from previous modes
  //    (e.g. isReconciling=true, reconcileFarmState still set)
  await resetAllStores();

  // 2. Load the plan — importPlan internally calls importPlanLogic which:
  //    - Hydrates initialStateStore, virtueStore, fuelTankStore, truthEggsStore, notesStore
  //    - Sets actions from the plan
  //    - Computes initial snapshot from hydrated stores
  //    - Recalculates (or skips if pre-calculated)
  const actionsStore = useActionsStore();
  actionsStore.activePlanId = plan.id;
  await actionsStore.importPlan(JSON.stringify(plan.data));

  // 3. Backfill: if this plan predates redactBackupForStorage (or was saved
  //    without a resolvable player ID) it has no rawBackup, so artifact
  //    recalculation (optimal set search, beam search) would otherwise need
  //    a live fetch every time it's used. Fetch one now and re-save the plan
  //    with the redacted backup baked in, so this only ever happens once per
  //    plan. Best-effort — see backfillMissingBackup's own doc comment.
  await backfillMissingBackup(plan);
}
